# Spec — sonda de solo lectura para que el canary junte el piso

**Slug**: `canary-trafico-sintetico` · **Fecha**: 2026-10-19 ·
**Autorización PO**: el gate exige `_CANARY_MIN_REQUESTS=30` y con el tráfico
real de prod la muestra no alcanza, así que hay que promover a mano. Pedido:
generar tráfico sintético de solo lectura contra la URL o el tag del canary
durante la ventana de espera, hasta el mínimo, y después evaluar tasa de
error y latencia como hoy. No bajar el umbral.

## Problema

El canario recibe el 1 % del tráfico. En 30 min ve unos pocos requests, por
debajo de 30. Con el piso en 30 el gate no llega a evaluar error rate ni p95,
y el release no se promueve solo. Bajar el piso reabre el falso positivo de
p95 del 2026-08-16 (n=6, cold start 1408 ms, 0 errores).

La spec `.specs/canary-muestra-insuficiente-promueve/spec.md` (2026-09-28)
hace WARN y promueve sin evaluar cuando la muestra no alcanza. Este pedido la
enmienda en el mecanismo: la ventana de espera genera la muestra. El piso 30,
los umbrales (error rate bajo 1 %, p95 bajo 500 ms) y la decisión de
`decidir_canary` cuando la muestra alcanza no cambian.

## Alcance

1. Durante `canary-sleep` (ventana de 1800 s) el pipeline manda GET al URL del
   tag `canary-signup-<sha>`: `_CANARY_MIN_REQUESTS` más cinco. El piso de la
   decisión no baja.
2. Rutas permitidas, y ninguna otra: `GET /health` y
   `GET /health/signup-flow`. Las dos son liveness público, sin auth, sin
   body, sin BD y sin datos de usuarios. No se usa `/ready` (hace `SELECT 1`
   y un 503 o una latencia de DB tumbaría el umbral de 1 % / 500 ms).
3. No hay POST, PUT, PATCH ni DELETE. No se manda `Authorization`. No se
   siguen redirects.
4. El ingress del api es `INTERNAL_LOAD_BALANCER`: un GET al `*.run.app` desde
   el worker de Cloud Build puede no contar como interno. El HTML 404 del
   frontend de Google es ingress. Un 5xx de `*.run.app` (aunque sea HTML) es
   la revisión, no ingress. Si la primera respuesta no es de la aplicación,
   la misma sonda corre en un Job efímero del cluster `booster-ai-telemetry`
   (VPC del proyecto, Private Google Access, namespace `default`). El DNS
   público de `*.run.app` no entra por Private Google Access: el pod fija el
   host del tag en `199.36.153.8` (`private.googleapis.com`). Sin eso el
   tráfico sale por Cloud NAT y el ingress vuelve a responder 404. El Job
   usa la imagen del api ya publicada **por digest**, con `command` que no
   arranca el servidor ni las migraciones. Los logs se leen en cuanto el Job
   termina (`Complete` o `Failed`) o en cuanto el objeto desaparece. No se
   espera solo `condition=complete` más allá del TTL. Se borra después de
   guardar los logs, también si falló o el sondeo hizo timeout. Si el Job
   ya no existe al leer, el gate no promueve.
5. La ventana sigue durando 30 min (el tiempo que no use la sonda se espera).
6. La sonda escribe `/workspace/canary-probe.json` (llegadas, 5xx, timeouts
   y errores de conexión). `canary-verify` lo lee antes de Monitoring y sale
   distinto de 0 si la sonda llegó a la app y vio 5xx o esos errores de
   transporte, o si había URL y fallaron el camino directo y el Job. Ese
   caso no termina en WARN. Si no hay archivo, reintenta Monitoring y decide
   como hoy: bajo el piso, WARN y promover sin mirar p95; en el piso o
   arriba, abortar si error rate ≥ 1 % o p95 ≥ 500 ms. El p95 de la ventana
   queda dominado por `/health`.
7. `_CANARY_MIN_REQUESTS` sigue en `'30'`.
8. El runbook `docs/qa/signup-canary-rollback.md` describe la sonda, las
   rutas y el fallback de VPC.

**No se toca**: umbrales de SLO, `release.yml`, IAM, Terraform, el split del
1 %, ni migraciones.

## Criterios de éxito

- [x] El plan de la sonda tiene `min_requests + 5` GET y solo las dos rutas
      de health. El piso de la decisión sigue en 30.
- [x] Una respuesta JSON de la app cuenta como llegada. El HTML 404 del
      frontend de Google cuenta como ingress y dispara el fallback. Un 5xx
      HTML de Cloud Run cuenta como la app, no como ingress.
- [x] El manifiesto del Job no arranca `dist/main.js`, no lleva token de la
      cuenta de servicio, fija requests de CPU y memoria, y solo recibe la
      URL del tag.
- [x] `_CANARY_MIN_REQUESTS` sigue en `'30'`.
- [x] (n=35, min=30, 5xx ≥ 1 % o p95 ≥ 500) sigue en exit 1.
- [x] (n=6, min=30) sin resultado de sonda sigue en exit 0 con WARN, sin
      evaluar p95.
- [x] Si la sonda llegó a la app y vio 5xx, o timeouts / errores de conexión,
      el gate sale distinto de 0 aunque Monitoring esté bajo el piso. No dice
      que promueve.
- [x] Con URL, camino directo y Job fallidos: exit distinto de 0, no WARN.
- [x] El Job resuelve el host del tag a `199.36.153.8`. Si el objeto
      desaparece antes de leer los logs, el gate sale distinto de 0 y no
      dice que promueve.
- [x] La imagen del Job va por digest. El CI corre los unittest de
      `scripts/deploy`.
- [x] El bloque Python de `canary-verify` no introduce `$` sin escapar, y el
      bash de `canary-sleep` tampoco (salvo substitutions de Cloud Build y
      `$$`).
