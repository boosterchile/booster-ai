# Sprint 2a terraform apply evidence

- **Date**: 2026-05-25
- **Operator**: PO `dev@boosterchile.com` via Claude Code agent
- **Project**: `booster-ai-494222`

## Timeline

| Time UTC | Event |
|---|---|
| 17:55:33 | First apply attempt — 16/18 resources created |
| 17:55:51 | First apply FAILED — Cloud Run update rejected |
| 18:13 | gcloud auth login refreshed |
| 18:14 | `init-demo-secrets-2026.sh` ejecutado — 4 versions created |
| 18:20 | PR #342 abierto: fix STRICT_MIG bug |
| 18:25 | PR #342 merged (commit `c117474`) |
| 18:26:46 | Retry apply iniciado |
| 18:27:12 | Apply complete |

## Root cause del primer apply failure

`STRICT_MIGRATION_ORDERING` estaba en el bloque `secrets = merge(local.common_secrets, { ... })` de `infrastructure/compute.tf` (Sprint 1 T3 leftover bug nunca aplicado a prod). El módulo `cloud-run-service` itera `var.secrets` como `secret_key_ref`, así que Cloud Run intentó montar un secreto literalmente llamado "false" (= `tostring(false)`).

Error: `spec.template.spec.containers[0].env[40].value_from.secret_key_ref.name: Secret projects/.../secrets/false/versions/latest was not found`.

Fix en PR #342: mover STRICT_MIGRATION_ORDERING al bloque `env_vars` con plain value.

## Resources creados/modificados (final state post-retry apply)

| Resource | Action | Status |
|---|---|---|
| `google_secret_manager_secret.hotfix_2026_05_14[demo-account-password-shipper-2026]` | created | ✓ |
| `google_secret_manager_secret.hotfix_2026_05_14[demo-account-password-carrier-2026]` | created | ✓ |
| `google_secret_manager_secret.hotfix_2026_05_14[demo-account-password-stakeholder-2026]` | created | ✓ |
| `google_secret_manager_secret.hotfix_2026_05_14[demo-account-password-conductor-2026-firebase]` | created | ✓ |
| 4 × `google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor` | created | ✓ |
| 4 × `google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin` | created | ✓ |
| `google_logging_metric.demo_ttl_low` | created | ✓ |
| `google_logging_metric.demo_uid_retired` | created | ✓ |
| `google_monitoring_alert_policy.demo_ttl_low` | created | ✓ enabled |
| `google_cloud_scheduler_job.demo_account_ttl_alert` | created | ✓ ENABLED, next run 2026-05-26T10:00:00Z |
| `google_monitoring_dashboard.telemetry_overview` | updated in-place | ✓ cosmetic |
| `module.service_api.google_cloud_run_v2_service.service` | updated in-place | ✓ revision `booster-ai-api-00320-nhd` serving 100% traffic |

## Cloud Run revision 00320 — env verification

51 env vars total (was 46 pre-apply, +5 nuevos).

Sprint 2a relevant:
- `DEMO_ACCOUNT_PASSWORD_SHIPPER_2026` — secret_key_ref ✓
- `DEMO_ACCOUNT_PASSWORD_CARRIER_2026` — secret_key_ref ✓
- `DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026` — secret_key_ref ✓
- `DEMO_ACCOUNT_PASSWORD_CONDUCTOR_FIREBASE_2026` — secret_key_ref ✓
- `STRICT_MIGRATION_ORDERING` — plain "false" ✓ (post fix PR #342)
- `DEMO_SEED_PASSWORD` — secret_key_ref ✓ (Sprint 1, sin cambios)

## Secret versions post init-demo-secrets-2026.sh

| Secret | Versions |
|---|---|
| `demo-account-password-shipper-2026` | 1 |
| `demo-account-password-carrier-2026` | 1 |
| `demo-account-password-stakeholder-2026` | 1 |
| `demo-account-password-conductor-2026-firebase` | 1 |

## Estado post-apply: ready for T4 one-shot retire

Pre-requisitos cumplidos:
- ✓ 4 demo secrets con version 1
- ✓ 4 env vars mounted en Cloud Run (revision 00320 serving traffic)
- ✓ TTL alerter cron ENABLED (próxima ejecución 06:00 Santiago = 10:00 UTC)
- ✓ Log-based metric + alert policy activos

Pendiente operacional (PO):
1. `node apps/api/scripts/harden-demo-accounts.mjs --recreate --dry-run` — verificar plan
2. `node apps/api/scripts/harden-demo-accounts.mjs --recreate` — crear 4 nuevas UIDs Firebase
3. Curl-verify 4 nuevas UIDs activas (commands en `docs/qa/demo-accounts.md`)
4. `node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch --dry-run`
5. `node apps/api/scripts/harden-demo-accounts.mjs --retire-old-batch` — retire 4 UIDs viejas
6. SLA 4h post-deploy approval; **forbidden Friday después 12:00 Santiago**.

Today is Monday 2026-05-25 → ventana operacional OK.
