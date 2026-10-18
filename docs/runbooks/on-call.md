# Runbook — On-call de Booster AI

Ventana real de respuesta, severidades y circuito de un incidente. Fijada por el PO el 2026-10-08 (T10-18, [ADR-082](../adr/082-objetivo-trl10-supersede-precomercial.md)).

## Quién y por dónde

- **Operador único**: `dev@boosterchile.com` (ADR-076). No hay segundo nivel ni rotación. Si el operador no está disponible, nadie más atiende; esto es una limitación declarada, no un hueco del runbook.
- **Canal de alerta**: email al notification channel de `infrastructure/monitoring.tf` (`local.alert_channel_ids`). No hay Slack ni PagerDuty.
- **Zona horaria**: America/Santiago para comunicar al PO y a clientes; UTC en registros operacionales.

## Ventana de respuesta

| Severidad | Qué es | Horario hábil (L–V 09:00–19:00 America/Santiago) | Fuera de horario (noches, fines de semana, feriados) |
|---|---|---|---|
| **P0** | Seguridad física o caída total: crash, unplug o jamming crítico (`telemetry-monitoring.tf`), `telemetry_gateway_down_p1` sostenido, API caída (`uptime_failures`), fast-burn de un SLO de disponibilidad, fallas no controladas en bucle (`backend_errores_reportados`, severidad CRITICAL). | Acuse ≤ 1 h | Acuse ≤ 30 min, **best-effort** |
| **P1** | Degradación con impacto en clientes: error rate > 1 %, p95 > 2 s, consumer de telemetría detenido, parser errors sostenidos, slow-burn de SLO, DLQ con mensajes, huella con data-quality degradada. | Acuse ≤ 1 h | Siguiente día hábil |
| **P2** | Sin impacto inmediato: backlog creciendo, connection cap del gateway, alertas de costo, storage de Cloud SQL > 80 %. | Mismo día hábil | Siguiente día hábil |

"Acuse" = el operador leyó la alerta, abrió el runbook correspondiente y registró el inicio en el log del incidente (abajo). No es resolución.

"Best-effort" significa que fuera de horario el compromiso es solo para P0 y depende de que el operador esté localizable. No es un SLA contractual. Cualquier contrato B2B que prometa más que esta tabla requiere ampliar la guardia primero.

## Circuito de un incidente

1. **Acusar recibo** dentro de la ventana. Anotar la hora (America/Santiago y UTC).
2. **Clasificar** P0/P1/P2 con la tabla de arriba. Ante duda, subir de severidad.
3. **Estabilizar** con el runbook de la alerta (índice en [`README.md`](README.md) §Alerta → runbook). Prioridad: detener el daño (rollback de revisión en Cloud Run, escalar el consumer, pausar el flujo afectado) antes de entender la causa.
4. **Comunicar** si hay clientes afectados (P0 siempre; P1 si dura > 1 h): mensaje breve con qué falla, desde cuándo y próxima actualización.
5. **Registrar** el estado en `docs/handoff/CURRENT.md` si el incidente no se cierra en 30 min o cruza el fin del horario.
6. **Cerrar** cuando la alerta se resuelve y la métrica vuelve a su rango. Para P0 y P1, el post-mortem es obligatorio dentro de 5 días hábiles con [`post-mortem-template.md`](post-mortem-template.md), guardado como `docs/incidents/INC-YYYY-MM-DD-<slug>.md`.

## Límites que el operador no cruza durante un incidente

Los fija `CLAUDE.md` y rigen también bajo presión:

- Un `terraform apply`, una migración `contract` o `REAPER_DESTRUCTIVE=true` en prod requieren una lista de verificación escrita y una corrida en seco registrada antes de ejecutarse (ADR-076).
- Los secretos se tocan solo por Terraform o la consola.
- Un rollback de revisión en Cloud Run está permitido sin esa lista porque es reversible y lo es por diseño (canary).

## Runbooks relacionados

- Por servicio: `service-*.md` (índice en [`README.md`](README.md)).
- Telemetría: [`oncall-telemetry-incidents.md`](oncall-telemetry-incidents.md).
- Huella y certificados GLEC: [`incidentes-glec.md`](incidentes-glec.md).
- Mandato de cobro: [`mandato-de-cobro.md`](mandato-de-cobro.md).
- Migraciones: [`db-migration-rollback.md`](db-migration-rollback.md).
- Recuperación ante desastre: [`dr-failover-test.md`](dr-failover-test.md).
