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
