"""Decisión del gate canary-verify. Stdlib, sin red.

La sonda escribe su resultado antes de mirar Monitoring. Si llegó a la app y
vio 5xx, o timeouts y errores de conexión, aborta. Si había URL del tag y
fallaron el camino directo y el Job, aborta. Esos casos no promueven.
Sin resultado de sonda (no había URL): muestra bajo el piso → WARN y promover
(exit 0), sin evaluar error rate ni p95.
Muestra suficiente: abortar si error_rate >= 1% o p95 >= 500ms.
Con min_requests en 0, cualquier n >= 1 evalúa los SLO (falso positivo de
p95 del 2026-08-16). El pipeline deja el piso en 30 para no reabrir eso.
El p95 de la ventana queda dominado por /health: la sonda es la mayoría de
los requests y ese handler no toca la base.
"""

from __future__ import annotations

import json


def reintentos_de_muestra(
    total: int,
    min_requests: int,
    intento: int,
    max_intentos: int,
) -> bool:
    """True si conviene volver a leer Monitoring antes de decidir.

    La ingesta de request_count llega unos segundos después de la sonda.
    Con el piso en 0 no se reintenta: cualquier n >= 1 ya evalúa los SLO.
    """
    if min_requests <= 0 or intento >= max_intentos:
        return False
    return total < max(min_requests, 1)


def decidir_resultado_sonda(resultado: dict[str, object] | None) -> tuple[int, list[str]]:
    """Aborta si la sonda vio un fallo propio. None o sin URL no aborta."""
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


def decidir_gate(
    resultado: dict[str, object] | None,
    total: int,
    min_requests: int,
    counts: dict[str, int],
    p95s: list[float],
) -> tuple[int, list[str]]:
    """La sonda manda sobre el WARN de muestra chica. Después, Monitoring."""
    codigo, lineas = decidir_resultado_sonda(resultado)
    if codigo != 0:
        return codigo, lineas
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
    lineas: list[str] = []
    if total < max(min_requests, 1):
        if min_requests > 0:
            lineas.append(
                f'canary-verify: WARN muestra insuficiente ({total} < {min_requests}) — '
                'el canary al 1% no junta el piso; no se evalúa p95. Promoviendo.'
            )
            return 0, lineas
        lineas.append(
            'canary-verify: WARN 0 requests en la ventana — sin muestra (min_requests=0), '
            'promoviendo; subir _CANARY_MIN_REQUESTS cuando haya tráfico real'
        )
        return 0, lineas

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
