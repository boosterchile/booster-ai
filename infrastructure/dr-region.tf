# Región de DR retirada (ADR-081, 2026-09-28).
#
# El clúster GKE `booster-ai-telemetry-dr`, la subnet `booster-ai-dr-private`,
# la IP `booster-ai-telemetry-dr-lb` y el DNS `telemetry-dr` salen de este
# archivo. El gateway de esa región ya estaba en 0 réplicas (ADR-058) y
# Cloud SQL no tiene réplica fuera de Santiago, así que el fee de Autopilot
# y el NAT de us-central1 no entregaban failover.
#
# No se toca el rango de peering `booster-cloudbuild-pool-range-dr`:
# `reserved_peering_ranges` de `google_service_networking_connection` es
# force-new y recrearía el peering de Cloud SQL.
#
# Reactivar DR es un ADR nuevo. El manifiesto y este archivo viven en git
# anterior a ADR-081; un scale-up ya no alcanza.
