# Spec — Recorte del piso fijo de GCP

**Estado:** aplicado en producción el 2026-09-28. Evidencia en `ship.md`
**Fecha:** 2026-09-28
**Owner:** Felipe Vicencio (`dev@boosterchile.com`)
**Origen:** revisión `docs/audits/costos-servicios-2026-09-28.md` y el pedido de ejecutar los cortes que esa revisión sostiene.
**ADR:** [ADR-081](../../docs/adr/081-retiro-cluster-dr-frio.md) supersede la cláusula de ADR-058 que dejaba el clúster DR latente.

## 1. Objetivo

Bajar el piso mensual de `booster-ai-494222` sacando lo que se paga con el gateway de respaldo en cero réplicas, y bajar el `telemetry-processor` de 2 vCPU a 1 vCPU sin apagar el consumer.

## 2. Qué se corta

| # | Cambio | Dónde | Ahorro estimado |
|---|---|---|---|
| R1 | Destruir el clúster GKE `booster-ai-telemetry-dr`, su subnet, la IP externa `booster-ai-telemetry-dr-lb` y el DNS `telemetry-dr` | `infrastructure/dr-region.tf` | fee de clúster ~USD 73 + pods de sistema |
| R2 | Destruir Cloud NAT y el router de `us-central1` | `infrastructure/wave-3-tls.tf` (solo los recursos `dr_nat`) | ~USD 32 + GB |
| R3 | Destruir el worker pool `booster-production-pool-dr` | `infrastructure/cloudbuild.tf` | < USD 1 (ocioso) |
| R4 | `telemetry-processor` `cpu` 2 → 1. Se mantienen `min_instances=1`, `cpu_idle=false` y `memory=1Gi` | `infrastructure/compute.tf` y el step de Cloud Build | ~USD 47 |

Manifiestos que solo servían a ese clúster (`telemetry-tcp-gateway-dr.yaml`, `cert-dr.yaml`, `cloudbuild-dr-*.yaml`) salen del repo para que un deploy no los vuelva a aplicar.

## 3. Qué no se corta, y por qué (revisión en profundidad)

| Candidato | Decisión | Motivo |
|---|---|---|
| Rango de peering `booster-cloudbuild-pool-range-dr` y la fila en `google_service_networking_connection.private_vpc` | Se queda | El provider marca `reserved_peering_ranges` como force-new. Sacar la fila recrea el peering de Cloud SQL. El rango interno no es una IP pública: el costo es ~0 |
| Cloud SQL por debajo de `db-custom-1-6144`, Redis bajo 1 GB, VPC connector bajo 2 | Se queda | Ya están en el piso del servicio o, en SQL, la RAM medida en mayo (~3,7 GB) no cabe con margen en 3,75 GB. Sin métrica fresca de Capacity no se baja la única base |
| `min_instances=0` en el processor | Se queda | Incidente 2026-06-07: el pull se apaga y la telemetría cae ~26 h |
| Clúster y NAT de Santiago, los dos LB del gateway (5027 y 5061) | Se queda | Son el TCP de Teltonika. Cloud Run no sostiene esa conexión |
| Datadog | Se queda | ADR-071 lo eligió el PO para infra y logs del gateway. Esta sesión no tiene la factura de Datadog ni `kubectl` al clúster. Borrar el manifiesto no baja la factura si el agente ya está instalado, y desinstalarlo sin ver el costo contradice una decisión vigente |
| Proyectos `big-cabinet-482101-s3` y `gen-lang-client-0486421631` | Se queda | El 2026-09-28 el dominio ya sirve Booster AI y el hosting Firebase del proyecto legacy responde Site Not Found. Eso no prueba que el proyecto GCP esté borrado, y esta sesión no tiene ADC para leer el billing. El delete queda para cuando Costos → por proyecto muestre el neto de 30 días. Revisión: `docs/audits/booster-2-0-2026-09-28.md` |
| Workspace y Twilio | Se queda | No hay credenciales de esas consolas. El corte es de asientos y categorías en la pestaña Uso, no de Terraform |
| Cloud Run placeholder con `min_instances=0` | Se queda | El costo idle es ~0 |
| CUD a 1 o 3 años | Se queda | ADR-058 los pospuso. Comprarlos antes de destruir el DR congela el fee que se quiere eliminar |
| `demo.boosterchile.com` | Se queda | Es el Slot 2 de producto. El costo de DNS es despreciable |

## 4. Criterios de éxito

- `terraform validate` y `terraform fmt -check` limpios, sin referencias rotas a `telemetry_dr`, `dr_nat`, `production_dr` ni `dr_lb_ip`.
- El processor queda en 1 vCPU con `min_instances=1` y `cpu_idle=false`.
- `google_service_networking_connection.private_vpc` no cambia de lista.
- Ningún recurso de IAM, Billing, service account, KMS ni firewall se modifica.
- El apply a producción no corre en esta sesión: no hay credenciales de `booster-ai-494222`, y ADR-076 exige plan en seco con salida registrada antes de un apply. El runbook de apply queda en `ship.md`.

## 5. Riesgo aceptado

Un Teltonika configurado con backup `telemetry-dr.boosterchile.com:5061` deja de tener a dónde caer si Santiago se cae. Con el gateway DR en 0 réplicas ese failover ya no entregaba servicio, y Cloud SQL no tiene réplica fuera de Santiago. El RTO pasa de «escalar un clúster que ya existe» a «reconstruir la región desde git». Aceptado por el pedido de cortar el piso pre-comercial.
