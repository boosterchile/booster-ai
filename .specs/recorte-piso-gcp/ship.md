# Ship — Recorte del piso fijo de GCP

**Estado:** código listo. Apply a producción **no ejecutado** en la sesión del 2026-09-28.

`terraform validate` (1.9.8, `init -backend=false`) salió Success. `terraform fmt -check` limpio. No hubo `terraform plan`: sin credenciales del state de producción.

## Por qué no hubo apply

ADR-076: `terraform apply` en producción exige lista de verificación escrita y un `terraform plan` con la salida registrada, antes de ejecutarlo. Esta sesión no tiene `gcloud` ni ADC de `booster-ai-494222` (`GOOGLE_CLOUD_PROJECT` del entorno es `booster-ai-dev` y no hay metadata de GCP). Sin plan no hay apply. La factura no baja hasta que corra el runbook de abajo.

## Lista de verificación (antes del apply)

- [ ] Backup on-demand de Cloud SQL. El plan no debe tocar la instancia; el backup es por si el peering se mueve igual.
- [ ] `terraform plan` completo. Tiene que destruir solo: clúster `telemetry_dr`, subnet `dr_private`, address `telemetry_dr_lb`, DNS `telemetry_dr`, router `dr_nat`, NAT `dr_nat`, worker pool `production_dr`.
- [ ] El plan **no** muestra replace de `google_service_networking_connection.private_vpc` ni de `google_sql_database_instance.main`. Si aparece, abortar.
- [ ] El plan del processor es `cpu = "2" -> "1"` in-place, con `min_instance_count = 1` y `cpu_idle = false` sin cambio.
- [ ] Ningún cambio en IAM, service accounts, KMS ni firewall.
- [ ] Ventana corta: al destruir el clúster, un device con backup `telemetry-dr.boosterchile.com` se queda sin failover. El primario de Santiago no se toca.

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
