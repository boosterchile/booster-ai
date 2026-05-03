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
- `CERTIFICATES_BUCKET` — `booster-ai-documents`
- `GOOGLE_APPLICATION_CREDENTIALS` — o `gcloud auth application-default login`
- `VERIFY_BASE_URL` (opcional) — default `https://api.boosterchile.com`

Exit code 1 si algún trip falló — útil para alerting en cron/CI.
