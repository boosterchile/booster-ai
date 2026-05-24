# T0 strict gate FAILURE — evidence + decision

**Date**: 2026-05-24
**Task**: T0 (drift reconcile demo_mode_activated default true→false)
**PR**: #315 (merged a main, commit `a899e14`, 2026-05-24)
**Strict gate criterion**: plan v3 §T0 P0-A — `terraform plan` desde main muestra EXACTAMENTE 1 línea de diff (flag flip). Cualquier otro diff bloquea apply.

## Result

```
Plan: 0 to add, 4 to change, 29 to destroy.
```

**Gate verdict**: 🛑 **FAILED**. 33 diff lines, no 1.

Plan completo capturado en [`t0-terraform-plan-strict-gate-FAILED.txt`](./t0-terraform-plan-strict-gate-FAILED.txt) (1134 líneas).

## Drift inventory

### 29 destroys — TODOS son `hotfix_2026_05_14_*` (abandoned branch artifacts)

| Recurso | Categoría | Cantidad |
|---|---|---|
| `google_secret_manager_secret.hotfix_2026_05_14[*]` | Secrets (7 distintos) | 7 |
| `google_secret_manager_secret_iam_member.hotfix_2026_05_14_api_accessor[*]` | IAM bindings api | 7 |
| `google_secret_manager_secret_iam_member.hotfix_2026_05_14_felipe_admin[*]` | IAM bindings PO admin | 7 |
| `google_secret_manager_secret_version.hotfix_2026_05_14_placeholder[*]` | Secret versions placeholder | 6 |
| `google_secret_manager_secret_version.pin_rate_limit_hmac_pepper` | Standalone secret version | 1 |
| `random_password.pin_rate_limit_hmac_pepper` | random_password generator | 1 |

**Total: 29 destroys** ✓

Los 7 secrets afectados (cada uno con secret + 2 IAM + version placeholder):

1. `demo-seed-password` ← **clave para H1.4 SC-1.4.2**
2. `pin-rate-limit-hmac-pepper` ← **clave para H2 si HMAC peppering aplica**
3. `demo-account-password-shipper` ← **clave para H1.1 SC-1.1.5**
4. `demo-account-password-carrier` ← **clave para H1.1 SC-1.1.5**
5. `demo-account-password-stakeholder` ← **clave para H1.1 SC-1.1.5**
6. `demo-account-password-conductor` ← **clave para H1.1 SC-1.1.5**
7. `sre-notification-webhook` ← deuda separada (no en plan Sprint 1)

### 4 changes in-place — cosmetic drift (no secrets, no IAM)

| Recurso | Tipo de cambio |
|---|---|
| `google_container_cluster.telemetry` | in-place update (probable: cosmetic — node-pool config o metadata) |
| `google_container_cluster.telemetry_dr` | in-place update (DR replica del anterior) |
| `google_monitoring_dashboard.telemetry_overview` | in-place update (cosmetic per commit `3fc85ad` notes) |
| `module.service_sms_fallback_gateway.google_cloud_run_v2_service.service` | env var update (1 env var add + 1 remove) |

## Análisis

**Causa**: la rama abandonada `feat/security-blocking-hotfixes-2026-05-14` ejecutó `terraform apply` el 2026-05-15 desde su HEAD. Ese apply:

1. Cambió `demo_mode_activated=false` en Cloud Run (lo que queríamos reconciliar — éxito).
2. **CREÓ** los 7 secrets `hotfix_2026_05_14_*` + IAM bindings + placeholder versions como parte de T1+T2 del plan viejo (commit `ad970bc`).
3. Aplicó otras "cosmetic" cambios (commit `3fc85ad` message dice: _"google_service_account.observability_workspace_reader (description align), google_service_account_iam_member.cloudrun_can_impersonate_workspace_reader (created), google_monitoring_dashboard.telemetry_overview (cosmetic drift)"_).

El state remoto guardó TODOS esos recursos. Main HEAD nunca recibió el merge → terraform diff desde main reporta "estos recursos existen en state pero no en config, destrúyelos".

## Decisión (per plan v3 §T0 P0-A)

> _"Si plan muestra >1 diff → STOP, document en evidence, escalate al PO + considerar split T0 en T0a (flag flip solo) + T0b (otros drifts post-T8)."_

**T0 SE SPLITTEA**:

- **T0a = code change only (variables.tf flip)** → **DONE** (PR #315 merged a main commit `a899e14`). Efecto: cualquier futuro `terraform apply` desde main usa `default=false`, NO revierte el demo flag silenciosamente. **Protective effect achieved**.

- **T0b = terraform apply reconcile** → **DEFERRED** hasta que las siguientes tasks merguen sus secrets en main HEAD config:
  - T7 declara `demo-seed-password` en Terraform
  - T9/T10 declara `pin-rate-limit-hmac-pepper` en Terraform (si aplica al H2 implementation)
  - H1.1 (Sprint 2) declara los 4 `demo-account-password-*` en Terraform
  - Separate decision: `sre-notification-webhook` — fuera del scope Sprint 1, but exists en state; tracked como `sre-notification-webhook-orphan` follow-up

Una vez todas las tasks dependientes mergeadas, T0b apply mostrará Plan con 0 destroys (porque main HEAD ya tiene los recursos declarados que matchean state) + cosmetic changes que pueden aplicarse safely.

**Sin T0b apply, prod sigue funcionando**: state remoto tiene los secrets, Cloud Run usa los env vars correctamente, demo flag stays `false`. La única consecuencia del split es que el state file de Terraform sigue divergente respecto a main HEAD config — pero ese drift está identificado y trackeado.

## Acción inmediata

1. Marcar T0 como **`[T0a DONE 2026-05-24 / T0b DEFERRED]`** en plan.md (nueva semántica de split).
2. Actualizar plan.md §"Future tasks" con T0b como acceptance:
   - T0b acceptance: post-merge T7+T7.5+T8+H1.1 secrets en main config, re-run `terraform plan`, verify 0 destroys, apply.
3. Identificar follow-up: `sre-notification-webhook` orphan secret — out of Sprint 1 scope.

## Recursos NO afectados (verificación)

Plan output confirma:
- **`google_redis_instance.main`**: NO en lista de changes/destroys → **redis state ya es `STANDARD_HA`** → T1 confirmado no-op (round 1 P0-1 verified).
- **`module.service_api.google_cloud_run_v2_service.service`**: NO en lista de changes → env var `DEMO_MODE_ACTIVATED=false` ya consistente entre main config (post-T0a) y state.
