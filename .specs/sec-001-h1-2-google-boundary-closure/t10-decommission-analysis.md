# T10 — Análisis de decomiso de la blocking function (SC-G7)

- **Spec**: [`spec.md`](./spec.md) SC-G7 (P1-3 endurecido) · **Plan**: [`plan.md`](./plan.md) T10 · **ADR**: [057](../../docs/adr/057-google-signup-boundary-and-reaper-supersedes-054.md)
- **Date**: 2026-06-04 · **Branch**: `feat/sec-001-boundary-closure`

Cumple los requisitos endurecidos de SC-G7 (DA P1-3): enumerar `state rm` vs `destroy` por recurso, verificar que ningún IAM binding removido es referenciado por un recurso no-blocking-function, y enumerar la monitoring infra.

## 1. Recursos Terraform removidos — `state rm` vs `destroy` (per-entorno)

> **Contexto clave**: ADR-054 quedó en `Proposed` y Sprint 2c-B **nunca se shipeó** (la wire `blocking_functions` "nunca aplicada" — ver nota de `identity-platform.tf` original). Por tanto, en prod lo esperable es que **ninguno** de estos recursos esté en state. dev/staging pudieron tener un apply parcial de prueba. El tratamiento correcto es **per-entorno**: `terraform plan` en cada uno revela el estado real.

| Recurso (de `auth-blocking-functions.tf` / `-monitoring.tf`) | Si está en state | Si NO está en state |
|---|---|---|
| `google_cloudfunctions_function.before_create` | `destroy` (apply remueve la función) | no-op |
| `google_storage_bucket.auth_blocking_source` | `destroy` | no-op |
| `google_storage_bucket_object.auth_blocking_placeholder` | `destroy` | no-op |
| `data.archive_file.auth_blocking_placeholder` | n/a (data source, no state real) | n/a |
| `google_cloudfunctions_function_iam_member.idp_invoker` | `destroy` | no-op |
| `google_project_iam_member.compute_default_storage_viewer` | `destroy` (ver §2 — seguro) | no-op |
| `google_logging_metric.signup_blocked_google` | `destroy` | no-op |
| `google_monitoring_alert_policy.signup_blocked_google_rate` | `destroy` | no-op |
| `google_monitoring_uptime_check_config.auth_blocking_reachability` | `destroy` | no-op |

Recurso **editado** (no removido):
| `google_identity_platform_config.default` (wire `blocking_functions`) | `update` in-place: terraform remueve el trigger `beforeCreate`. Se deja `blocking_functions` **fuera** de `ignore_changes` a propósito → converge a "sin trigger" en CADA entorno y remueve drift per-entorno. Si nunca se aplicó la wire → no-op. |

**`state rm` (sin `destroy`)**: ninguno requerido. No hay recurso que deba sacarse del state conservando el recurso vivo en GCP — todos los recursos de la blocking function deben desaparecer realmente. (`state rm` se usaría solo si quisiéramos dejar de gestionar un recurso pero mantenerlo; no es el caso.)

**Acción operacional (gate de SC-G7, fuera de este commit de código)**: correr `terraform plan` en `environments/{dev,staging,prod}` y confirmar que el plan solo contiene `destroy`/`update` de los recursos de arriba (cero efectos colaterales sobre otros recursos). Requiere acceso autenticado al backend de cada entorno; se ejecuta en el pipeline/bastión, no desde este entorno de desarrollo.

## 2. Verificación de reutilización de IAM (DA P1-3 — "ningún binding removido referenciado por recurso no-blocking-function")

| Binding removido | ¿Reusado por recurso no-blocking-function? | Veredicto |
|---|---|---|
| `google_cloudfunctions_function_iam_member.idp_invoker` (IdP service agent → `cloudfunctions.invoker` sobre `beforeCreate`) | No: la función deja de existir; el member es el service agent de Identity Platform, no usado en ningún otro binding. | **Seguro remover** |
| `google_project_iam_member.compute_default_storage_viewer` (compute default SA → `roles/storage.objectViewer` project-level) | **No.** Único consumidor era el build del Gen 1 function (leer `gcf-sources-*`). No existe otra Cloud Function (Gen 1/Gen 2) en el proyecto (`grep google_cloudfunctions*_function` → solo `before_create`). GKE Autopilot, que también corre como compute default SA, usa el binding **distinto** `compute_default_sa_artifact_reader` (`roles/artifactregistry.reader`, `iam.tf:237`), que **se conserva**. | **Seguro remover** |
| `local.identitytoolkit_service_agent` | No: local, usado solo por `idp_invoker`. | **Seguro remover** |
| `roles/cloudfunctions.viewer` en `local.github_deployer_roles` (`iam.tf`) | No: añadido solo para el workflow `sprint-2c-b-deploy-gate.yml` (`gcloud functions describe beforeCreate`), decomisado. No quedan Cloud Functions que inspeccionar. | **Removido en este commit** |

Bindings **conservados** (compartidos / no-blocking-function): `compute_default_sa_artifact_reader` (GKE), `github_deployer_self_impersonate`, `github_can_impersonate_runtime`, y el resto de `github_deployer_roles`.

## 3. Monitoring infra enumerada (no "la que solo servía…")

Removida con `auth-blocking-functions-monitoring.tf`:
- `google_logging_metric.signup_blocked_google` (log-based metric).
- `google_monitoring_alert_policy.signup_blocked_google_rate` (alert policy bootstrap).
- `google_monitoring_uptime_check_config.auth_blocking_reachability` (uptime check 403=healthy).

**Conservado**: `google_monitoring_notification_channel.email_alerts` — definido en `monitoring.tf`, **compartido** por ~20 recursos (api-cost-guardrails, crash-traces, signup-probe, telemetry-monitoring, etc.). El monitoring file de la blocking function solo lo **referenciaba**; removerlo no lo afecta.

## 4. APIs y residuales dejados a propósito

- `cloudfunctions.googleapis.com` (`project.tf:78`): **se deja habilitada**. Deshabilitar una API es invasivo y de bajo valor (no hay recursos que la usen tras el decomiso; el costo de tenerla habilitada es cero). Documentado aquí; no es un GAP.
- Comentario histórico en `compute.tf:210` (menciona la blocking function dentro del flag `SIGNUP_REQUEST_FLOW_ACTIVATED`): el flag sirve al flujo admin-approval **vigente**, no a la blocking function. No se toca.

## 5. Verificación local realizada

- `terraform init -backend=false` + `terraform validate` → **Success! The configuration is valid.** (sin referencias colgantes a `before_create` tras remover los 2 `.tf`).
- `terraform fmt` aplicado a `identity-platform.tf` + `iam.tf`.
- `grep` de refs a scripts/workflows removidos → cero refs en código/CI.
- Build del monorepo sin el workspace `apps/auth-blocking-functions` (0 consumidores; `pnpm-workspace.yaml` globa `apps/*`, la remoción es limpia).

## 6. Pendiente fuera de este commit (gate operacional)

- `terraform plan` per-entorno (dev/staging/prod) confirmando solo `destroy`/`update` esperados — corre en el pipeline autenticado.
- **Branch protection**: si alguno de los 3 workflows `sprint-2c-*` era un *required status check* en `main`, removerlo de la config de branch protection (GitHub UI) para que el PR de decomiso pueda mergear. Acción del PO.
