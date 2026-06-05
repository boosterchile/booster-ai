# Spec — Optimización de costos GCP pre-comercial

**Estado:** DEFINE → BUILD
**Fecha:** 2026-06-05
**Owner:** Felipe Vicencio (`dev@boosterchile.com`)
**Origen:** paquetes `Optimizar Costos 1.md` / `Optimizar Costos 2.md` (validados contra el código vivo el 2026-06-05).
**ADR habilitante:** [ADR-058](../../docs/adr/058-precomercial-rightsizing-disponibilidad-supersedes-035.md) — reclasificación a pre-comercial, supersede ADR-035 (que rechazaba estas palancas bajo objetivo TRL 10). Reversión trackeada en [`_followups/revertir-ha-al-firmar-b2b-sla.md`](../_followups/revertir-ha-al-firmar-b2b-sla.md).

## 1. Objetivo

Reducir el gasto mensual de GCP del proyecto `booster-ai-494222` de ~CLP 774.000/mes a ~CLP 350.000–450.000/mes (−45% aprox.) ajustando la infraestructura al tamaño real de lanzamiento (≤10 camiones), sin perder la capacidad de revertir cada palanca.

## 2. Por qué ahora

La infra está dimensionada para 1.000–10.000 dispositivos y un SLA B2B 99.9% que aún no tiene clientes asociados. El gasto subió +127% MoM. Pre-comercial no justifica HA/redundancia plena.

## 3. Criterios de éxito

- Todos los cambios de código aplicados como `update in-place` o scale-down — **ningún `replace`/`destroy` inesperado** en `terraform plan` (especialmente Bloque D / Cloud SQL).
- Cada palanca reversible vía flip de variable + `apply` o re-scale.
- `terraform validate` + `terraform fmt -check` limpios.

## 4. Alcance — palancas

| # | Cambio | Archivo | Toca disponibilidad |
|---|---|---|---|
| A1 | Redis `STANDARD_HA` → `BASIC` | `variables.tf` **+ `terraform.tfvars`** | Sí (failover) |
| A2 | Cloud Run `api` `min_instances` 1→0 | `compute.tf` | Sí (cold starts) |
| A3 | Logging Cloud SQL menos verboso | `data.tf` | No |
| A4 | Posponer CUDs 3 años | (acción FinOps, no código) | No |
| B1 | Gateway primary 2→1 réplica | `k8s/telemetry-tcp-gateway.yaml` | Sí (redundancia) |
| C1 | Gateway DR → 0 (borrar HPA + `replicas:0`) | `k8s/telemetry-tcp-gateway-dr.yaml` | Sí (failover regional) |
| C2 | Mantener base DR latente | (sin cambio: no borrar `dr-region.tf`) | — |
| D | Cloud SQL REGIONAL→ZONAL | `variables.tf` + `data.tf` | Sí (failover BD) |

### Corrección sobre el paquete original (defecto detectado)

- **A1**: el paquete solo cambiaba el `default` en `variables.tf`, pero `terraform.tfvars` setea `redis_tier = "STANDARD_HA"` explícito (gana sobre el default). Para que A1 surta efecto **hay que cambiar `terraform.tfvars`**. Cambiamos ambos por consistencia.

## 5. Fuera de alcance (lo ejecuta el humano, no el agente)

- `terraform apply` y `kubectl/gcloud` contra producción. Las palancas con downtime/recreación (D, A1) y las que reducen disponibilidad (A2, B1, C1) se aplican **una por una, en ventana baja, con backup previo en D**, según runbook. El agente deja el código + plan validado; la mutación de prod es decisión/acción humana (gate de aprobación, CLAUDE.md §Deploy).
- A4: acción manual en el Centro de FinOps.

## 6. Riesgos

- **D (Cloud SQL)**: si `terraform plan` muestra `replace` en `google_sql_database_instance.main` → **ABORTAR** (riesgo de pérdida de datos). Esperado: `~ update in-place` con `availability_type: "REGIONAL" -> "ZONAL"`. Backup on-demand obligatorio previo; el nombre de instancia es dinámico (`booster-ai-pg-${random_id.cloudsql_suffix.hex}`) → confirmar el sufijo real antes del backup.
- **A1 (Redis)**: el cambio de tier recrea la instancia (caché vacío, sin pérdida) y cambia `host`; Cloud Run re-despliega al leer el nuevo `REDIS_HOST`.
- Todos reversibles. Volver a HA/REGIONAL al firmar B2B con SLA 99.9%.

## 7. Reversión

Cada palanca: flip de variable (`BASIC→STANDARD_HA`, `false→true`) o re-scale + `terraform apply` / `kubectl apply`.
