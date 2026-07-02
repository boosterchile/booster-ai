# Follow-up — Revertir postura HA pre-comercial al firmar el primer B2B con SLA

**Origen:** ADR-058 (reclasificación a pre-comercial) · **Gatillo:** firma del primer contrato B2B con SLA de uptime.
**Estado:** latente (no accionar hasta el gatillo).

Al firmar el primer contrato B2B con SLA, revertir las palancas de `cost-optimization-precomercial`:

- [ ] Cloud SQL: `cloudsql_high_availability = true` (ZONAL → REGIONAL) + `terraform apply` (runbook en `.specs/cost-optimization-precomercial/`).
- [ ] Redis: `redis_tier = "STANDARD_HA"` (BASIC → HA) en `terraform.tfvars` + default en `variables.tf`.
- [ ] Gateway primary: `replicas`/HPA `minReplicas` 1 → 2.
- [ ] DR: reactivar gateway DR (`replicas` > 0 + recrear HPA) + scale-up.
- [ ] **Upgrade correcto, NO el warm anterior**: evaluar DR multi-región completo con **read replica de Postgres cross-region** (presupuesto dedicado). El DR previo nunca replicó la BD (ver ADR-058 §"Estado de la infraestructura").

Owner del gatillo: PO (Felipe Vicencio). Referencia: ADR-058, ADR-035 (superseded).
