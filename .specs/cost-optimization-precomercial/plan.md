# Plan — Optimización de costos GCP pre-comercial

Rama: `chore/cost-optimization-precomercial`. Orden de edición libre (no hay deps entre archivos); el orden de **aplicación** (humano) es A3 → A4 → A2 → B1 → C → A1 → D.

## Tareas (edición de código)

- [x] **T1 · A3** `data.tf`: `log_temp_files` `0`→`-1`; eliminados bloques `log_connections` y `log_disconnections`. Mantiene checkpoints/lock_waits/ddl.
- [x] **T2 · A2** `compute.tf` (`module "service_api"`): `min_instances` → `0`.
- [x] **T3 · A1** `variables.tf`: `redis_tier` default `STANDARD_HA`→`BASIC`. **Y** `terraform.tfvars` (local, gitignored): `redis_tier = "BASIC"`.
- [x] **T4 · B1** `k8s/telemetry-tcp-gateway.yaml`: Deployment `replicas: 1`; HPA `minReplicas: 1`.
- [x] **T5 · C1** `k8s/telemetry-tcp-gateway-dr.yaml`: Deployment `replicas: 0`; objeto `HorizontalPodAutoscaler` eliminado.
- [x] **T6 · D** `variables.tf`: nueva var `cloudsql_high_availability` (bool, default `false`). `data.tf`: `availability_type = var.cloudsql_high_availability ? "REGIONAL" : "ZONAL"`.

## Verificación (VERIFY)

- [x] **V1** `terraform fmt -check` + `terraform validate` → limpios.
- [ ] **V2** `terraform plan -out=opt.plan` → **bloqueado por creds GCP expiradas**. Re-correr tras `gcloud auth application-default login`. Confirmar **0 `replace`/`destroy`**; Cloud SQL in-place.
- [x] **V3** manifiestos K8s validados (estructura + valores correctos).

## Fuera de alcance del agente (runbook humano)

- A4: rechazar CUDs en Centro de FinOps.
- Aplicación a prod: `terraform apply` y `kubectl/gcloud` uno por uno, ventana baja, backup previo en D. Documentado en `ship.md`.
