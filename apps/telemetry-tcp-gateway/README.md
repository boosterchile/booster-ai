# @booster-ai/telemetry-tcp-gateway

**Runtime**: `gke-autopilot`
**Status**: `live` (en producción — GKE Autopilot, deploy automatizado vía ADR-065)

TCP server Teltonika Codec8. GKE Autopilot (ADR-005). 1000+ conexiones persistentes.

## Operación

Servicio operativo en producción (ingesta TCP de los dispositivos Teltonika → `telemetry-events`).

- **Runbook**: [`docs/runbooks/service-telemetry-tcp-gateway.md`](../../docs/runbooks/service-telemetry-tcp-gateway.md) — síntomas, diagnóstico (`kubectl` sobre el cluster `booster-ai-telemetry`, ns `telemetry`), restart/rollback (`kubectl rollout undo`), escalación.
- **Deploy**: automatizado vía DNS endpoint + Cloud Build (ADR-065).
- **Parser**: `packages/codec8-parser` (Codec8 GPS/CAN/safety events).
- **TLS / CA**: ver ADR-040 (preload de CA para FMC150).
