# Verify — Optimización de costos GCP pre-comercial

**Fecha:** 2026-06-05
**Rama:** `chore/cost-optimization-precomercial`

## Resultados

| Check | Resultado |
|---|---|
| V1 · `terraform fmt -check -recursive` | ✅ exit 0 (sin cambios de formato pendientes) |
| V1 · `terraform validate` | ✅ "Success! The configuration is valid." |
| V3 · YAML manifiestos K8s | ✅ ver abajo |
| V2 · `terraform plan` | ✅ **ejecutado** 2026-06-05 tras `gcloud auth application-default login`. Resultado completo en §"V2 · Resultado". (El primer intento falló por creds expiradas; reautenticado y corrido.) |

## V3 · Manifiestos K8s (validación estructural)

`k8s/telemetry-tcp-gateway.yaml` (primary) — 6 objetos:
- Deployment `telemetry-tcp-gateway`: `replicas = 1` ✅ (B1)
- HorizontalPodAutoscaler `telemetry-tcp-gateway`: `minReplicas = 1` ✅ (B1)

`k8s/telemetry-tcp-gateway-dr.yaml` (DR) — 4 objetos (antes 5):
- Deployment `telemetry-tcp-gateway`: `replicas = 0` ✅ (C1)
- HorizontalPodAutoscaler: **eliminado** ✅ (C1 — Autopilot no soporta `minReplicas: 0`)

## V2 pendiente — criterio de aceptación

Al re-correr `terraform plan -out=opt.plan` con credenciales válidas, confirmar:
- **0 `replace` / 0 `destroy`**. Especialmente `google_sql_database_instance.main` debe ser `~ update in-place` con `availability_type: "REGIONAL" -> "ZONAL"`. Si aparece `-/+` (replace) → **ABORTAR** (riesgo de pérdida de datos).
- Cambios esperados: Redis tier (recreación de Memorystore — esperada, caché vacío), `service_api` min_instances 1→0, flags Cloud SQL (log_temp_files, drop log_connections/log_disconnections), availability_type.

## V2 · Resultado `terraform plan` (2026-06-05, post-reauth)

`Plan: 4 to add, 10 to change, 7 to destroy.`

### Mis cambios — todos correctos
- ✅ **Cloud SQL (D): `~ update in-place`** — NO replace. Criterio de aceptación cumplido (sin riesgo de datos).
- ✅ **Redis (A1): `REPLACE`** — esperado (cambio de tier recrea Memorystore; caché vacío).
- ✅ **Cloud Run api (A2) + 6 services**: `update in-place` (min_instances + propagación de nuevo `REDIS_HOST`).

### 🔴 BLOQUEANTE — plan contaminado con drift prod↔main NO relacionado
El plan arrastra 9 cambios ajenos a la optimización de costos (drift entre código `main` y estado desplegado):

- **DELETE**: `google_cloudfunctions_function.before_create`, `google_storage_bucket.auth_blocking_source`, `google_storage_bucket_object.auth_blocking_placeholder`, `google_project_iam_member.compute_default_storage_viewer`, `github_deployer_bindings["roles/cloudfunctions.viewer"]`, `human_owners["group:admins@boosterchile.com"]`
- **CREATE**: `google_logging_metric.auth_is_demo_blocked`, `google_monitoring_alert_policy.auth_is_demo_blocked_anomaly`, `human_owners["user:dev@boosterchile.com"]`
- **UPDATE**: `google_identity_platform_config.default`, `google_monitoring_dashboard.telemetry_overview`

**Diagnóstico**: el código de `main` ya migró SEC-001 H1.2 (boundary closure, ADR-057, commit `d867bdf`) de "blocking Cloud Function" a "logging metric + alert", pero **el estado de prod no lo refleja** — pese a que `5f2b411` marca el cierre como *Shipped (terraform apply validado)*. Además, drift de IAM humana (`human_owners`: `group:admins` desplegado vs `user:dev` en código).

**Implicación**: `terraform apply opt.plan` aplicaría cost-opt **+** teardown SEC-001 **+** cambio de IAM humana en un solo apply. Prohibido por CLAUDE.md (IAM humana requiere PR revisado). **No aplicar opt.plan tal cual.**

## Nota — `terraform.tfvars` gitignored

`infrastructure/terraform.tfvars` está en `.gitignore`. El cambio `redis_tier = "BASIC"` se aplicó al archivo local (lo usa el `plan`/`apply` desde esta máquina) pero **no se commitea**. Lo permanente en repo es el `default = "BASIC"` en `variables.tf`. Quien aplique en prod debe asegurar que su tfvars tenga `redis_tier = "BASIC"`, o el override `STANDARD_HA` persistiría.
