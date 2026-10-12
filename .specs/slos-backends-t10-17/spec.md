# Spec — SLOs con burn-rate para backends (T10-17)

Programa TRL 10, fase C ([ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md), `.specs/trl10/spec.md`).

## Entradas

- `infrastructure/slo.tf` tiene SLOs y alertas de burn-rate solo para api y web.
- telemetry-tcp-gateway (GKE, TCP 5027), telemetry-processor (consumidor
  Pub/Sub) y whatsapp-bot (webhook HTTP) no tienen SLO.

## Salidas

| Servicio | SLI | Objetivo |
|---|---|---|
| whatsapp-bot | request-based, `run.googleapis.com/request_count` no-5xx | 99 % |
| telemetry-processor | request-based, good = `ack_message_count`, bad = `dead_letter_message_count` en `telemetry-events-processor-sub` | 99,5 % |
| telemetry-tcp-gateway | windows-based (5 min), uptime check TCP 5027 al LB público | 99,5 % |

- Uptime check TCP nuevo `telemetry_gateway_tcp` (60 s).
- Una alerta de burn-rate por SLO (fast 14,4× / 1 h, slow 6× / 6 h), mismos
  canales que el resto.
- Ningún recurso de IAM, Billing, service accounts, KMS ni firewall.

## Criterios de éxito

- [x] `terraform fmt -check` limpio.
- [ ] `terraform validate` / plan en CI (`terraform-drift.yml`) sin errores.
- [ ] Post-apply (PO): los 3 SLOs aparecen en Cloud Monitoring → Services con
      budget calculado, y las 3 políticas `SLO burn — …` existen.
