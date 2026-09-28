# Ship — Recorte del piso fijo de GCP

**Estado:** aplicado en producción el 2026-09-28, con la cuenta `contacto@boosterchile.com`.

## Evidencia del apply

Backup on-demand de `booster-ai-pg-07d9e939`: id `1790597034016`, SUCCESSFUL, 2026-09-28T12:03:54Z–12:06:56Z.

`terraform plan` completo: 1 add, 2 change, 7 destroy. Los 7 destroy eran el clúster DR, la subnet, la IP, el DNS `telemetry-dr`, el router, el NAT y el worker pool. El processor pasaba de 2 vCPU a 1. El plan también quería crear `google_kms_crypto_key_iam_member.cloud_run_certificate_version_viewer` y montar `CONTENT_SID_ACTIVACION_CONDUCTOR` en `booster-ai-api`. Esos dos no son el recorte: no se aplicaron.

Antes del destroy, `deletion_protection` del clúster pasó de true a false con `-target=google_container_cluster.telemetry_dr` (0 added, 1 changed, 0 destroyed). El apply acotado siguiente: `Apply complete! Resources: 0 added, 1 changed, 7 destroyed.`

Verificación en vivo:

- Clústeres: solo `booster-ai-telemetry` en `southamerica-west1`, RUNNING.
- Routers: solo `booster-ai-nat-router-primary`.
- Sin record `telemetry-dr.boosterchile.com`.
- Revisión `booster-ai-telemetry-processor-00390-qqf`: cpu `1`, memory `1Gi`, `minScale=1`, `cpu-throttling=false`, Ready.
- Sigue el rango interno `booster-cloudbuild-pool-range-dr`. No se tocó el peering de Cloud SQL.

## Lista de verificación

- [x] Backup on-demand de Cloud SQL. El plan no tocó la instancia.
- [x] `terraform plan` completo. Los 7 destroy eran clúster `telemetry_dr`, subnet `dr_private`, address `telemetry_dr_lb`, DNS `telemetry_dr`, router `dr_nat`, NAT `dr_nat` y worker pool `production_dr`.
- [x] El plan no mostró replace de `google_service_networking_connection.private_vpc` ni de `google_sql_database_instance.main`.
- [x] El processor quedó `cpu = "2" -> "1"` in-place, con `minScale = 1` y sin CPU throttling.
- [x] El apply acotado no incluyó IAM, service accounts, KMS ni firewall. El plan completo sí proponía un binding KMS y un env del api; se dejaron fuera.
- [x] El clúster de Santiago no se tocó.

## Runbook de apply (dos pasos por `deletion_protection`)

El flag vive en el state de Terraform, no en la API de GKE. Un apply del código final con el state viejo falla al destruir el clúster y puede destruir el NAT y la IP en el mismo apply. Por eso el clúster se desprotege primero.

Desde `infrastructure/`, con ADC de `booster-ai-494222`:

```bash
# 1. Volver a traer el clúster al working tree y bajar el flag.
git checkout 976c490 -- infrastructure/dr-region.tf
# En ese archivo, google_container_cluster.telemetry_dr: deletion_protection = false
terraform apply -target=google_container_cluster.telemetry_dr

# 2. Restaurar el código de ADR-081 y destruir.
git checkout HEAD -- infrastructure/dr-region.tf
terraform plan -out=recorte-piso.plan
# Revisar la lista de verificación contra el plan. Recién entonces:
terraform apply recorte-piso.plan
```

`976c490` es el commit de la spec, anterior al retiro: `dr-region.tf` todavía declara el clúster con `deletion_protection = true`. El paso 1 lo deja en `false` y aplica solo ese target. El paso 2 destruye.

Después del apply, en la pestaña Costos del dashboard el fee de un clúster GKE y un Cloud NAT tienen que irse en los días siguientes (el billing export atrasa ~un día). El processor baja de CPU cuando el apply (o el próximo deploy, que ya fija `--cpu=1 --memory=1Gi`) cree la revisión nueva.

## Rollback

El primario no cambia, así que no hay rollback de telemetría de Santiago. Volver a tener DR es un ADR nuevo más restaurar los manifiestos desde git anterior a ADR-081 y un apply. No es un scale-up: el clúster ya no está.
