# ADR-081 — Retiro del clúster de DR frío

**Estado**: Vigente
**Fecha**: 2026-09-28
**Decider**: Felipe Vicencio (Product Owner), por el pedido de ejecutar el recorte de piso
**Supersede a**: la cláusula de [ADR-058](./058-precomercial-rightsizing-disponibilidad-supersedes-035.md) que conservaba latentes el clúster `booster-ai-telemetry-dr`, su subnet, la IP, el DNS `telemetry-dr` y el NAT de `us-central1`
**Relacionado**: ADR-034 (right-sizing, sigue vigente), ADR-058 (SQL zonal, Redis BASIC y `min_instances=0` siguen vigentes), ADR-071 (Datadog, no se toca)

---

## Contexto

ADR-058 reclasificó el producto a pre-comercial y bajó el gateway de DR a 0 réplicas, pero dejó el clúster Autopilot, el NAT y la IP creados para poder reactivarlos en 15–40 minutos. Autopilot cobra el fee de clúster (USD 0,10/h) y los pods de sistema aunque no haya réplicas de aplicación. El NAT de la región se cobra igual. Cloud SQL sigue siendo zonal en Santiago, así que ese clúster nunca levantaba la base si caía la región.

La revisión del 2026-09-28 (`docs/audits/costos-servicios-2026-09-28.md`) dejó este corte como la palanca más grande que todavía se paga. El PO pidió ejecutar los cortes que esa revisión sostiene.

## Decisión

Se elimina la región de DR fría de la infraestructura declarada:

- Clúster GKE Autopilot `booster-ai-telemetry-dr`, subnet `booster-ai-dr-private`, IP `booster-ai-telemetry-dr-lb`, registro DNS `telemetry-dr`.
- Cloud NAT y router de `us-central1`.
- Worker pool de Cloud Build `booster-production-pool-dr`.

Se conserva el rango de peering interno `booster-cloudbuild-pool-range-dr` dentro de `google_service_networking_connection.private_vpc`. Quitarlo recrea el peering de Cloud SQL (el argumento es force-new en el provider). El rango no es una IP pública.

El `telemetry-processor` baja de 2 vCPU a 1 vCPU. Siguen vigentes `min_instances=1` y CPU siempre asignada: el consumer es pull y apagarlo repite el incidente del 2026-06-07.

No se reabre Datadog (ADR-071), ni se borran otros proyectos del billing, ni se vuelve a HA.

## Consecuencias

El failover automático del Teltonika a `telemetry-dr.boosterchile.com` deja de existir. Reconstruir DR es un ADR nuevo y un apply desde el historial de git, no un scale-up. Hasta el primer contrato con SLA de uptime, el RTO de una caída de `southamerica-west1` es el de restaurar la región a mano.

El apply que destruye el clúster es irreversible en el sentido de ADR-076: exige el runbook de `.specs/recorte-piso-gcp/ship.md` y un `terraform plan` registrado antes de correrlo. `deletion_protection` del clúster vive en el state de Terraform; hace falta un apply que lo baje a `false` antes del apply que lo destruye.

## Referencias

- `.specs/recorte-piso-gcp/spec.md`
- `docs/audits/costos-servicios-2026-09-28.md`
