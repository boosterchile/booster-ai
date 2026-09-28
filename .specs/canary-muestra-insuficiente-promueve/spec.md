# Spec — el canary promueve si la muestra no alcanza el piso

**Slug**: `canary-muestra-insuficiente-promueve` · **Fecha**: 2026-09-28 ·
**Autorización PO**: «preparar el deploy para que termine bien».

## Problema

Desde el 2026-08-16 `_CANARY_MIN_REQUESTS` es `30`. El canario recibe el 1 % del
tráfico de la API y en la ventana de 30 min ve 3–8 requests. `canary-verify`
sale con código 1 (`FAIL muestra insuficiente`) y Cloud Build no ejecuta
`deploy-api`, `gke-deploy` ni `smoke-api-health`. Los releases quedan a medias.
El último release completo en success es el del 2026-08-04.

Bajar el piso a `0` reabre el falso positivo del 2026-08-16: con n=6 el p95 es
el máximo, un cold start de 1408 ms y 0 errores abortó un deploy sano.
Generar 30 hits en el tag no es viable desde Cloud Build: el ingress de la API
es `INTERNAL_LOAD_BALANCER` y el probe público solo cae ~1 % en el canario.

Esta spec enmienda el desenlace de
`.specs/chore-canary-min-requests/spec.md` (muestra insuficiente abortaba). El
piso 30 y la prohibición de evaluarlo en `0` se mantienen.

## Alcance

1. Decisión pura en `scripts/deploy/canary_verify_decision.py`, llamada desde
   el step `canary-verify` de `cloudbuild.production.yaml`.
2. Si `total < max(min_requests, 1)` y `min_requests > 0`: WARN y exit 0. No
   se evalúa error rate ni p95.
3. Si `total >= max(min_requests, 1)`: igual que hoy. Abortar si
   `error_rate >= 1 %` o si el p95 `>= 500 ms`.
4. `_CANARY_MIN_REQUESTS` sigue en `'30'`.
5. Comentario de la substitution y el runbook
   `docs/qa/signup-canary-rollback.md` describen el desenlace nuevo.

**No se toca**: `release.yml`, el sleep de 30 min, los umbrales de SLO, IAM,
Terraform, ni el valor de la substitution.

## Criterios de éxito

- [x] (n=6, min=30, p95=1408, 0 errores) → exit 0 y el mensaje es WARN. No dice FAIL.
- [x] (n=0, min=30) → exit 0.
- [x] (n=29, min=30) → exit 0.
- [x] (n=35, min=30, 5xx/total >= 1 %) → exit 1.
- [x] (n=35, min=30, p95 >= 500) → exit 1.
- [x] (n=35, min=30, sano) → exit 0.
- [x] (n=6, min=0, p95 >= 500) → exit 1. Documenta por qué el piso no vuelve a 0.
- [x] El YAML sigue en `'30'` y ya no contiene `FAIL muestra insuficiente`.
- [x] El bloque nuevo del YAML no introduce `$` sin escapar.
- [x] `python3` compila el step y `unittest` queda en verde.
