"""Decisión del gate canary-verify. Stdlib, sin red.

La sonda escribe su resultado antes de mirar Monitoring. Si llegó a la app y
vio 5xx, o timeouts y errores de conexión, aborta. Si había URL del tag y
fallaron el camino directo y el Job, aborta. Esos casos no promueven y no
revierten el tag solos: el rollback de un SLO lo hace el humano.

Sin URL del tag, con _CANARY_MIN_REQUESTS en 0, o con muestra bajo el piso,
el canary falla (exit 1): no promueve y la línea REVERTIR_TAG pide devolver
el 100 % a la revisión estable y quitar el tag. Ya no hay WARN que promueva.

Si la sonda llegó a la app y Monitoring quedó bajo el piso, respuestas_app
cubre el piso cuando llega a _CANARY_MIN_REQUESTS. En ese caso se evalúan
error rate y p95. Si tampoco la sonda llega al piso, falla y se revierte.

Muestra suficiente: abortar si error_rate >= 1% o p95 >= 500ms.
El p95 de la ventana queda dominado por /health: la sonda es la mayoría de
los requests y ese handler no toca la base.
"""

from __future__ import annotations

import json
import math

MARCA_REVERTIR = 'canary-verify: REVERTIR_TAG'
ALERTA_REVERTIR = (
    'canary-verify: ALERTA revertir el tag falló; el 1% puede quedar — NO promover'
)
INTENTOS_REVERSION = 3


def reintentos_de_muestra(
    total: int,
    min_requests: int,
    intento: int,
    max_intentos: int,
) -> bool:
    """True si conviene volver a leer Monitoring antes de decidir.

    La ingesta de request_count llega unos segundos después de la sonda.
    Con el piso en 0 no se reintenta: ese piso es sin muestra y falla.
    """
    if min_requests <= 0 or intento >= max_intentos:
        return False
    return total < min_requests


def conviene_leer_p95(total: int, min_requests: int, llego: bool, respuestas_app: int) -> bool:
    """Latencia de Monitoring solo con el piso cubierto por request_count.

    Con 0 < total < piso el p95 de Monitoring castiga el cold start. Esa
    muestra usa las latencias de la sonda, no esta serie.
    """
    del llego, respuestas_app
    if min_requests <= 0:
        return False
    return total >= min_requests


def percentil_95(latencias_ms: list[float]) -> float | None:
    """p95 por nearest-rank. Vacío no es 0: no hay muestra de latencia."""
    if not latencias_ms:
        return None
    ordenadas = sorted(latencias_ms)
    indice = max(0, math.ceil(0.95 * len(ordenadas)) - 1)
    return float(ordenadas[indice])


def p95_de_sonda(resultado: dict[str, object] | None) -> list[float]:
    """p95 que la sonda escribió, o el calculado desde latencias_ms."""
    if not isinstance(resultado, dict):
        return []
    crudo = resultado.get('p95_ms')
    if isinstance(crudo, (int, float)) and not isinstance(crudo, bool):
        return [float(crudo)]
    latencias = resultado.get('latencias_ms')
    if not isinstance(latencias, list):
        return []
    valores: list[float] = []
    for item in latencias:
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            valores.append(float(item))
    valor = percentil_95(valores)
    if valor is None:
        return []
    return [valor]


def espera_backoff_reversion(intento: int) -> int:
    """Segundos tras un intento fallido. 3 intentos: 2 s y luego 4 s."""
    if intento < 1 or intento >= INTENTOS_REVERSION:
        return 0
    return 2**intento


def decidir_resultado_sonda(resultado: dict[str, object] | None) -> tuple[int, list[str]]:
    """Aborta si la sonda vio un fallo propio. None o sin URL no aborta aquí."""
    if not isinstance(resultado, dict) or not resultado.get('tenia_url'):
        return 0, []
    cinco = int(resultado.get('cinco_xx') or 0)
    transporte = int(resultado.get('errores_transporte') or 0)
    if resultado.get('llego_a_la_app'):
        if cinco > 0:
            return 1, [
                'canary-verify: FAIL la sonda llegó a la app y vio '
                f'{cinco} respuestas 5xx — NO promover'
            ]
        if transporte > 0:
            return 1, [
                'canary-verify: FAIL la sonda llegó a la app y tuvo '
                f'{transporte} timeouts o errores de conexión — NO promover'
            ]
        return 0, []
    directo = str(resultado.get('camino_directo') or '')
    job = str(resultado.get('job') or '')
    if job == 'perdido':
        return 1, [
            'canary-verify: FAIL el Job ya no existía al leer el resultado '
            '(ttlSecondsAfterFinished o un delete anterior a los logs) — NO promover'
        ]
    directo_fallo = directo not in ('ok', 'no_necesario', 'no_corrido')
    job_fallo = job in ('fallo', 'no_corrido')
    if directo_fallo and job_fallo:
        return 1, [
            'canary-verify: FAIL la sonda no llegó a la app: falló el camino '
            f'directo ({directo}) y el Job ({job}), con URL del tag — NO promover'
        ]
    return 0, []


def _falla_sin_muestra(mensaje: str) -> tuple[int, list[str]]:
    return 1, [mensaje, MARCA_REVERTIR]


def _entero(valor: object) -> int:
    if isinstance(valor, bool) or valor is None:
        return 0
    if isinstance(valor, int):
        return valor
    if isinstance(valor, float):
        return int(valor)
    if isinstance(valor, str):
        try:
            return int(valor.strip())
        except ValueError:
            return 0
    return 0


def evaluar_slos(
    total: int,
    counts: dict[str, int],
    p95s: list[float],
) -> tuple[int, list[str]]:
    """Error rate y p95. El llamador ya comprobó que el piso está cubierto."""
    lineas: list[str] = []
    err = counts.get('5xx', 0)
    rate = err / total
    lineas.append(f'canary-verify: requests={total} 5xx={err} error_rate={rate:.4f}')
    if rate >= 0.01:
        lineas.append(f'canary-verify: FAIL error_rate {rate:.2%} >= 1% — NO promover')
        lineas.append(
            'canary-verify: runbook — revisar 5xx de la revision canary en Cloud Logging '
            'antes de decidir rollback del 1% o fix-forward (decision humana).'
        )
        return 1, lineas

    if p95s:
        worst = max(p95s)
        lineas.append(f'canary-verify: p95_max={worst:.0f}ms')
        if worst >= 500:
            lineas.append(f'canary-verify: FAIL p95 {worst:.0f}ms >= 500ms — NO promover')
            lineas.append(
                'canary-verify: contexto — con muestra chica el p95 se acerca al maximo y '
                'castiga cold-starts (incidente 2026-08-16: n=6, p95=1408ms, 0 errores era '
                f'falso positivo). Muestra actual: {total} requests. Decision humana: '
                'comparar contra latencia de la revision estable antes de rollback.'
            )
            return 1, lineas
    else:
        lineas.append(
            'canary-verify: WARN sin serie de latencias — solo gate de error_rate aplicado'
        )
    lineas.append('canary-verify: OK — promoviendo a 100%')
    return 0, lineas


def decidir_gate(
    resultado: dict[str, object] | None,
    total: int,
    min_requests: int,
    counts: dict[str, int],
    p95s: list[float],
) -> tuple[int, list[str]]:
    """Sonda, piso y Monitoring. Sin muestra: exit 1 y REVERTIR_TAG."""
    if min_requests <= 0:
        return _falla_sin_muestra(
            'canary-verify: FAIL _CANARY_MIN_REQUESTS=0 es sin muestra — NO promover'
        )
    codigo, lineas = decidir_resultado_sonda(resultado)
    if codigo != 0:
        return codigo, lineas
    if not isinstance(resultado, dict) or not resultado.get('tenia_url'):
        return _falla_sin_muestra('canary-verify: FAIL sin URL del tag — NO promover')
    llego = bool(resultado.get('llego_a_la_app'))
    respuestas = _entero(resultado.get('respuestas_app'))
    if total < min_requests and llego and respuestas >= min_requests:
        nota = (
            f'canary-verify: Monitoring={total} < {min_requests}; '
            f'piso cubierto por respuestas_app={respuestas}'
        )
        de_sonda = p95_de_sonda(resultado)
        if total > 0:
            # 0 < total < piso: el p95 de Monitoring es el cold start.
            serie = de_sonda
        else:
            serie = de_sonda if de_sonda else p95s
        if not serie:
            return 1, [
                nota,
                'canary-verify: FAIL sin p95 de la sonda — NO promover',
            ]
        efectivo = total if total > 0 else respuestas
        conteos = counts if total > 0 else {'2xx': respuestas}
        codigo_slo, lineas_slo = evaluar_slos(efectivo, conteos, serie)
        return codigo_slo, [nota, *lineas_slo]
    if total < min_requests and llego:
        return _falla_sin_muestra(
            'canary-verify: FAIL muestra insuficiente '
            f'(monitoring={total}, respuestas_app={respuestas} < {min_requests}) — NO promover'
        )
    codigo_mon, lineas_mon = decidir_canary(total, min_requests, counts, p95s)
    return codigo_mon, lineas + lineas_mon


def leer_resultado_sonda(path: str) -> tuple[dict[str, object] | None, int, list[str]]:
    """None si no hay archivo. JSON ilegible aborta: no se promueve a ciegas."""
    try:
        with open(path, encoding='utf-8') as fh:
            cargado = json.load(fh)
    except FileNotFoundError:
        return None, 0, []
    except json.JSONDecodeError:
        return None, 1, [
            'canary-verify: FAIL resultado de la sonda ilegible — NO promover'
        ]
    if not isinstance(cargado, dict):
        return None, 1, [
            'canary-verify: FAIL resultado de la sonda ilegible — NO promover'
        ]
    return cargado, 0, []


def decidir_canary(
    total: int,
    min_requests: int,
    counts: dict[str, int],
    p95s: list[float],
) -> tuple[int, list[str]]:
    if min_requests <= 0:
        return _falla_sin_muestra(
            'canary-verify: FAIL _CANARY_MIN_REQUESTS=0 es sin muestra — NO promover'
        )
    if total < min_requests:
        return _falla_sin_muestra(
            f'canary-verify: FAIL muestra insuficiente ({total} < {min_requests}) — NO promover'
        )
    return evaluar_slos(total, counts, p95s)


def revision_estable(
    traffic: list[object],
    tag: str,
    *,
    latest_ready: str | None = None,
    latest_created: str | None = None,
) -> str | None:
    """Revisión que se queda con el 100 % al quitar el tag canary.

    Ignora la entrada de ese tag. Si el estable es latestRevision sin
    revisionName, usa latestReadyRevisionName y, si esa es el canary,
    latestCreatedRevisionName. Si no hay a quién devolver el tráfico,
    devuelve None.
    """
    canary: set[str] = set()
    mejor_peso = -1
    mejor_nombre: str | None = None
    peso_latest = -1
    hay_latest_sin_nombre = False
    for item in traffic:
        if not isinstance(item, dict):
            continue
        nombre = item.get('revisionName')
        nombre_ok = isinstance(nombre, str) and bool(nombre.strip())
        if str(item.get('tag') or '') == tag:
            if nombre_ok and isinstance(nombre, str):
                canary.add(nombre.strip())
            continue
        peso = _entero(item.get('percent'))
        if nombre_ok and isinstance(nombre, str) and peso > mejor_peso:
            mejor_peso = peso
            mejor_nombre = nombre.strip()
            continue
        if item.get('latestRevision') is True and not nombre_ok and peso > peso_latest:
            peso_latest = peso
            hay_latest_sin_nombre = True
    if mejor_nombre is not None and mejor_peso >= peso_latest:
        return mejor_nombre
    if hay_latest_sin_nombre:
        for candidato in (latest_ready, latest_created):
            if isinstance(candidato, str) and candidato.strip() and candidato.strip() not in canary:
                return candidato.strip()
    return mejor_nombre


def resultado_reversion(doc: object, tag: str) -> tuple[int, list[str]]:
    """0 y el nombre de la revisión estable, o 1 y la alerta. No toca tráfico."""
    if not isinstance(doc, dict):
        return 1, [ALERTA_REVERTIR]
    status = doc.get('status')
    if not isinstance(status, dict):
        return 1, [ALERTA_REVERTIR]
    traffic = status.get('traffic')
    nombre = revision_estable(
        traffic if isinstance(traffic, list) else [],
        tag,
        latest_ready=status.get('latestReadyRevisionName')
        if isinstance(status.get('latestReadyRevisionName'), str)
        else None,
        latest_created=status.get('latestCreatedRevisionName')
        if isinstance(status.get('latestCreatedRevisionName'), str)
        else None,
    )
    if not nombre:
        return 1, [ALERTA_REVERTIR]
    return 0, [nombre]


def main(argv: list[str] | None = None) -> int:
    """Dry-run del gate con un resultado de sonda ya escrito. No llama a Monitoring."""
    import argparse

    parser = argparse.ArgumentParser(description='Dry-run de canary-verify, sin Cloud Monitoring')
    parser.add_argument('--resultado', required=True)
    parser.add_argument('--total', type=int, default=0)
    parser.add_argument('--min-requests', type=int, default=30)
    parser.add_argument('--dos-xx', type=int, default=0)
    parser.add_argument('--cinco-xx', type=int, default=0)
    parser.add_argument('--p95', type=float, default=None)
    args = parser.parse_args(argv)
    resultado, codigo, lineas = leer_resultado_sonda(args.resultado)
    for linea in lineas:
        print(linea)
    if codigo != 0:
        return codigo
    counts: dict[str, int] = {}
    if args.dos_xx:
        counts['2xx'] = args.dos_xx
    if args.cinco_xx:
        counts['5xx'] = args.cinco_xx
    p95s = [] if args.p95 is None else [args.p95]
    codigo, lineas = decidir_gate(resultado, args.total, args.min_requests, counts, p95s)
    for linea in lineas:
        print(linea)
    return codigo


if __name__ == '__main__':
    import sys

    sys.exit(main())
