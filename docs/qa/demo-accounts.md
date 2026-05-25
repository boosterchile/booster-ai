# docs/qa/demo-accounts.md — Runbook cuentas demo (SEC-001 H1.1)

- **Sprint**: 2a
- **Spec**: `.specs/sec-001-cierre/spec.md` v3.3 §3 H1.1.
- **Plan**: `.specs/sec-001-cierre/plan-sprint-2a.md` T4 + T6b.
- **ADR**: `docs/adr/053-post-disclosure-account-replacement.md`.
- **Service module**: `apps/api/src/services/harden-demo-accounts.ts`.
- **CLI wrapper**: `apps/api/scripts/harden-demo-accounts.mjs`.

> **Versión minimal (T4 commit)**. Expansión completa con per-UID metadata
> + Cloud Monitoring alerts en T6b.

## SLA operacional

- **One-shot retire** post-PR #1 prod-deploy approved: **4h max**.
- **Forbidden ejecutar one-shot retire Friday después de 12:00 hora Chile**
  (4h SLA fits before 16:00 cutoff per CLAUDE.md). Si deploy approval cae
  viernes-pm, posponer one-shot al lunes y aceptar window-of-overlap extra.

## Window-of-overlap durante recreate + retire

Cronología obligatoria post-PR-merge:

1. **T4 + T5 + T6a + T7b merged a main** (PR Sprint 2a #1).
2. **terraform apply** desde máquina PO (mountea 4 secrets nuevos + 4 env
   vars en Cloud Run + Cloud Monitoring alert policies + Cloud Scheduler
   cron TTL alerter).
3. **`init-demo-secrets-2026.sh`** ejecutado por PO post-apply: genera
   passwords iniciales en los 4 secrets (idempotent — Sprint 1 T7.5 pattern).
4. **Prod deploy approval** (Cloud Build manual gate).
5. **Cloud Run revision restart**: nueva revision mountea los 4 env vars
   nuevos.
6. **`harden-demo-accounts.mjs --recreate`**: crea 4 UIDs nuevas en
   Firebase. Idempotent.
7. **curl-verify 4 nuevas activas** (comando exacto abajo).
8. **T6a Cloud Monitoring alert activa** (silent-window guard arma timer
   de 4h).
9. **`harden-demo-accounts.mjs --retire-old-batch`**: retira las 4 UIDs
   viejas. SLA 4h desde paso 4.

Window-of-overlap pre-step-9: las 4 UIDs viejas siguen activas con
password compromised. Vector activo pero **monitoreado** (T6a alert).
Step 9 cierra el vector.

## Curl-verify pre-retire

Antes de step 9, verificar las 4 nuevas UIDs están activas:

```bash
PROJECT="${PROJECT:-booster-ai-494222}"
for email in \
  demo-2026-shipper@boosterchile.com \
  demo-2026-carrier@boosterchile.com \
  demo-2026-stakeholder@boosterchile.com \
  drivers+demo-2026-conductor@boosterchile.invalid
do
  echo "── $email"
  curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" \
       -H "Content-Type: application/json" \
       "https://identitytoolkit.googleapis.com/v1/accounts:lookup" \
       -d "{\"email\":[\"$email\"]}" \
    | jq '.users[0] | {localId, disabled, customClaims}'
done
```

Output esperado por cada email:

```json
{
  "localId": "<nueva-uid>",
  "disabled": false,
  "customClaims": "{\"is_demo\":true,\"persona\":\"<persona>\",\"expires_at\":\"<ISO>\"}"
}
```

Si alguna nueva UID no aparece o aparece `disabled: true`, **NO ejecutar
retire** — investigar primero.

## Comandos canónicos

### Staging rehearsal (siempre antes de prod)

```bash
node apps/api/scripts/harden-demo-accounts.mjs --recreate --dry-run
node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch --dry-run
```

Output del dry-run imprime el plan completo (qué UIDs se tocarían) sin
mutar Firebase ni DB.

### Prod one-shot retire (4h SLA, weekday only)

```bash
# Paso 1 — recreate (idempotent; si las 4 ya existen del T4 build, skip)
node apps/api/scripts/harden-demo-accounts.mjs --recreate

# Paso 2 — curl-verify (sección anterior)

# Paso 3 — retire batch
node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch
```

Anotar evidencia en `.specs/sec-001-cierre/sprint-2a-evidence/t4-one-shot-retire.md`
con: timestamp inicio, output del curl-verify, output del --retire-old-batch
(con counters `retired`/`skippedAlreadyDisabled`/`failed`), timestamp fin.

### Renovación TTL (cuando alerta T6a dispara -7 días)

```bash
node apps/api/scripts/harden-demo-accounts.mjs --renew <uid> --extend-days 30
```

Lookup UID per persona vía: `gcloud firestore documents list` o
`identitytoolkit accounts:lookup` (igual que curl-verify arriba).

### Recovery from partial-retire

Si el batch retire falla mid-execution (network glitch, gcloud token
expiró), simplemente **re-ejecutar el comando** — es idempotent:

```bash
node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch
```

Las UIDs ya disabled serán contadas como `skippedAlreadyDisabled`. Las
restantes se retirarán.

## Per-UID metadata (post T4 one-shot)

Hasta que T4 `--recreate` corra en prod, los `firebase_uid` no existen
todavía. Post-recreate, completar esta tabla con los UIDs reales
extraídos del Firebase console o `gcloud identity-platform accounts:lookup`:

| Persona | Email | Firebase UID | Secret name | Owner |
|---|---|---|---|---|
| `generador_carga` | `demo-2026-shipper@boosterchile.com` | `<TBD>` | `demo-account-password-shipper-2026` | dev@boosterchile.com |
| `transportista` | `demo-2026-carrier@boosterchile.com` | `<TBD>` | `demo-account-password-carrier-2026` | dev@boosterchile.com |
| `stakeholder` | `demo-2026-stakeholder@boosterchile.com` | `<TBD>` | `demo-account-password-stakeholder-2026` | dev@boosterchile.com |
| `conductor` | `drivers+demo-2026-conductor@boosterchile.invalid` | `<TBD>` | `demo-account-password-conductor-2026-firebase` | dev@boosterchile.com |

**Propósito común**: 4 cuentas demo del subdominio `demo.boosterchile.com`.
Custom claim `{ is_demo: true, persona: <enum>, expires_at: <ISO+30d> }`.
TTL renovable via `harden-demo-accounts.mjs --renew`. NUNCA usar para
producción real — `is-demo` middleware enforcement bloquea writes
estructurales en endpoints no-allowlisted (T7/H1.3 Sprint 2b).

**Sin secrets en este archivo** — solo punteros a Secret Manager.
Acceso PO + API SA via IAM bindings declarados en
`infrastructure/security-hotfixes-2026-05-14.tf`.

## Cloud Monitoring alerts asociadas

T6a Sprint 2a (`infrastructure/monitoring.tf` §"T6a SEC-001"):

### Alert activo

**`demo_ttl_low`** (`google_monitoring_alert_policy.demo_ttl_low`):

- **Fires when**: log-based metric `sec001/demo_ttl_low` rate > 0
  sustained 60s (= al menos 1 evento `jsonPayload.event="demo.ttl_low"`
  en la última ventana 1min).
- **Source**: el cron `demo-account-ttl-alert` (Cloud Scheduler daily
  06:00 Santiago) invoca `runDemoTtlAlerter` que emite el log solo si
  `days_remaining ≤ 7` Y Redis dedup key no existe para el día actual.
- **Notification channel**: `email_alerts` (`var.alert_email`,
  típicamente PO).
- **Auto-close**: 25h post-trigger (cron diario hará silenciar el
  alert el día siguiente si TTL renovado).
- **Action**: ejecutar `node apps/api/scripts/harden-demo-accounts.mjs
  --renew <uid> --extend-days 30` para la persona afectada (UID +
  persona aparecen en el log payload).

### Log-based metric ready (sin alert todavía)

**`demo_uid_retired`** (`google_logging_metric.demo_uid_retired`):

- Counter DELTA que cuenta eventos `jsonPayload.event="audit.demo_uid_
  retired"` (emitidos por `harden-demo-accounts.ts retire()` por cada
  UID retirada).
- Sin alert policy aún. Una vez T4 one-shot retire ejecute por primera
  vez en prod (4 eventos esperados), agregar **silent-window guard
  alert**: `count(metric) < 4 sustained 4h post-deploy` → notify
  on-call. Tracked como follow-up post-operational-T4 para evitar
  alert fired-on-empty-state pre-execution.

Ver `infrastructure/monitoring.tf` líneas finales para HCL canónico.

## Rotación de password per persona

```bash
PROJECT=booster-ai-494222
for secret in \
  demo-account-password-shipper-2026 \
  demo-account-password-carrier-2026 \
  demo-account-password-stakeholder-2026 \
  demo-account-password-conductor-2026-firebase
do
  openssl rand -base64 16 | gcloud secrets versions add "$secret" \
    --project="$PROJECT" --data-file=-
done
```

Post-rotación: **Cloud Run revision restart** para que mountee la nueva
version del env var. Sin restart, el seed-demo/harden lee la version
vieja durante la lifetime del Cloud Run instance.

## Referencias

- Spec: [`.specs/sec-001-cierre/spec.md`](../../.specs/sec-001-cierre/spec.md) §3 H1.1.
- Plan: [`.specs/sec-001-cierre/plan-sprint-2a.md`](../../.specs/sec-001-cierre/plan-sprint-2a.md) T4 + T5 + T6a + T6b.
- ADR: [`docs/adr/053-post-disclosure-account-replacement.md`](../adr/053-post-disclosure-account-replacement.md).
- Sprint 1 T7.5 evidence (pattern reference): [`.specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md`](../../.specs/sec-001-cierre/sprint-1-evidence/t7-5-secret-init.md).
