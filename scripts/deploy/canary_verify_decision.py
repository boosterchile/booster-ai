"""Decisión del gate canary-verify. Stdlib, sin red.

Muestra bajo el piso: WARN y promover (exit 0), sin evaluar error rate ni p95.
Muestra suficiente: abortar si error_rate >= 1% o p95 >= 500ms.
Con min_requests en 0, cualquier n >= 1 evalúa los SLO (falso positivo de
p95 del 2026-08-16). El pipeline deja el piso en 30 para no reabrir eso.
"""

from __future__ import annotations


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
