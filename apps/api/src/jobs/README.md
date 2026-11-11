# Jobs one-shot del api

Scripts ejecutables manualmente (no Cloud Run Jobs todavía — eso es overkill para
operaciones puntuales). Cada archivo es self-contained y se corre con `tsx`.

## Ejecución general

```bash
# Desde cualquier directorio:
pnpm --filter @booster-ai/api exec tsx src/jobs/<nombre>.ts [args]
```

Las env vars necesarias varían por job — ver el comentario superior de cada
archivo. Para acceso a Cloud SQL desde la Mac, levantá el proxy primero:

```bash
./scripts/db/connect.sh   # arranca el Cloud SQL Auth Proxy + setea DATABASE_URL
```

## Jobs disponibles

### `backfill-certificados.ts`

Encuentra trips entregados sin certificado de huella de carbono y los emite.
Idempotente — el servicio mismo skipea si el cert ya existe.

```bash
# Dry-run para ver qué emitiría:
pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts --dry-run

# Real (emite y sube a GCS):
pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts

# Con límite (útil para probar incremental):
pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts --limit=10

# Concurrencia (default 1, max 10 — KMS quotas):
pnpm --filter @booster-ai/api exec tsx src/jobs/backfill-certificados.ts --concurrency=5
```

Env vars requeridas:
- `DATABASE_URL` — apuntando al Cloud SQL Auth Proxy
- `CERTIFICATE_SIGNING_KEY_ID` — resource ID de la KMS key
- `CERTIFICATES_BUCKET` — `{project}-certificates-{env}` (bucket PROPIO desde 2026-06-11; NO usar documents — su retención SII rompe la re-emisión)
- `GOOGLE_APPLICATION_CREDENTIALS` — o `gcloud auth application-default login`
- `VERIFY_BASE_URL` (opcional) — default `https://api.boosterchile.com`

Exit code 1 si algún trip falló — útil para alerting en cron/CI.

### `hc001-fuente-combustible-can.ts`

HC-001: corrige `vehiculos.fuente_combustible_can` (KZXB64 89→83, LFGR63 84→83,
KZBB26 84→sin_sensor) con guarda sobre el valor previo y exactamente 3 filas en
una transacción. Dry-run por defecto. La ejecuta Ops Platform con OK de Felipe.

Imprime el destino que pg va a usar (`<host>:<port>/<db>`, sin password) y aborta
si es ambiguo (host o DB vacíos, socket, multi-host, `?host=`/`?port=` distintos).
Con `DRY_RUN=false` exige `CONFIRMAR_DESTINO` exactamente igual a ese destino.
Cualquier otro valor de `DRY_RUN` es dry-run.

En prod se entra por el túnel IAP (cloud-sql-proxy en localhost): el destino es
algo como `localhost:5436/booster_ai`. **Cópialo tal cual de la salida del dry-run**,
no lo escribas a mano.

```bash
# 1. Dry-run (default): imprime {"destino":"localhost:5436/booster_ai",...}
SENTIDO=up pnpm --filter @booster-ai/api exec tsx src/jobs/hc001-fuente-combustible-can.ts
# 2. Real (solo con el visto de Felipe):
SENTIDO=up DRY_RUN=false CONFIRMAR_DESTINO=<destino del dry-run> pnpm --filter @booster-ai/api exec tsx src/jobs/hc001-fuente-combustible-can.ts
# Reversa:
SENTIDO=reversa DRY_RUN=false CONFIRMAR_DESTINO=<destino del dry-run> pnpm --filter @booster-ai/api exec tsx src/jobs/hc001-fuente-combustible-can.ts
```

### `rellenar-rutas.ts`

Relleno de rutas (ADR-088, `.specs/ruta-parada-servicio/` parte 3). Deja cada
asignación con su ruta de dos paradas en el estado que le corresponde: crea la
que falta y pone al día la que creó el accept y cuya asignación avanzó después
(hasta la parte 4, recogida, entrega y conductor se escriben solo en la
asignación). La lógica vive en `src/services/rellenar-rutas.ts`.

Requiere la migración 0078 aplicada. Dry-run por defecto. Una transacción: si
la verificación final falla (alguna asignación sin ruta, o una ruta distinta de
su asignación), no escribe nada. Idempotente: la segunda corrida informa 0
creadas y 0 conciliadas. Lo ejecuta el PO.

Una asignación con datos que no cuadran (por ejemplo, recogida sin fecha de
recogida) no se rellena: sale en `omitidas` con su motivo y el job termina con
código 1.

```bash
# 1. En seco (default): imprime el destino y lo que haría.
pnpm --filter @booster-ai/api exec tsx src/jobs/rellenar-rutas.ts
# 2. Real (solo con el visto del PO), con el destino copiado de la salida anterior:
DRY_RUN=false CONFIRMAR_DESTINO=<destino de la corrida en seco> pnpm --filter @booster-ai/api exec tsx src/jobs/rellenar-rutas.ts
```

No tiene reversa automática. Para deshacerlo: `UPDATE asignaciones SET ruta_id =
NULL` y borrar `eventos_ruta`, `paradas_ruta` y `rutas`, en ese orden. Mientras
la ruta no tenga lectores (antes de la parte 4) eso no cambia nada visible.

### `reap-orphan-onboarding-firebase.ts`

Borra el usuario Firebase **huérfano** del onboarding admin-provisioned
(onboarding-flow-redesign T1.7): el approve crea el user Firebase y persiste
`firebase_uid` antes de que el dueño complete el alta; si el token expira sin
consumirse, ese user queda huérfano (credencial viva). El reaper de cuentas
inertes NO lo limpia (protege solicitudes `aprobado`), por eso este job dedicado.

Selección: `estado='aprobado' AND token_hash NOT NULL AND consumido_en IS NULL
AND expira_en < now() AND firebase_uid NOT NULL`. Borra vía `firebase_uid` y
nulea la columna (marcador idempotente).

```bash
# Dry-run (default) — solo loguea/cuenta lo que borraría:
pnpm --filter @booster-ai/api exec tsx src/jobs/reap-orphan-onboarding-firebase.ts

# Real (borra) — requiere el flag explícito:
ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE=true \
  pnpm --filter @booster-ai/api exec tsx src/jobs/reap-orphan-onboarding-firebase.ts
```

Env vars:
- `DATABASE_URL` — Cloud SQL Auth Proxy.
- `ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE` — `"true"` para borrar; otro = dry-run.
- `ONBOARDING_ORPHAN_REAPER_MAX_DELETES` — cap por corrida (default 50).

> **Trigger MANUAL** (no Cloud Run Job todavía) ⇒ higiene operacional, NO
> mitigación automática. El riesgo "huérfano Firebase" (spec §9) queda ABIERTO
> hasta cablear un Cloud Scheduler; ese cableado es **gate del flip** de
> `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (ver `.specs/onboarding-flow-redesign/plan.md`
> Cierre Fase 1).
