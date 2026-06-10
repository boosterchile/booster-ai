# Follow-up: segundo canal de notificación para alertas (P0 incluidas)

**Origen**: Auditoría 2026-06-09 (infraestructura), riesgo medio "canal de alertas único".
**Prioridad**: P2 (P1 si se firma el primer cliente B2B).

## Problema

TODAS las alertas de Cloud Monitoring — incluidas las P0 de crash forensics y el consumer-stall de telemetría — notifican a un único canal: email a dev@boosterchile.com (`infrastructure/monitoring.tf:8-18`). Un email no leído de madrugada = incidente sin atender. El secret `sre-notification-webhook` (Slack) existe como shell (`security-hotfixes-2026-05-14.tf:44-46`) pero ningún `google_monitoring_notification_channel` tipo webhook lo consume.

## Acción propuesta

1. **PO**: crear el webhook (Slack incoming webhook del workspace Booster, o canal Telegram/SMS según preferencia) y poblar el secret `sre-notification-webhook`.
2. Terraform: `google_monitoring_notification_channel` tipo `webhook_tokenauth` (o `slack` nativo con OAuth) + agregarlo a `notification_channels` de las alert policies P0/P1 (mantener email como secundario).
3. Verificación: disparar una alerta de prueba (bajar el umbral de pubsub_backlog durante la prueba y restaurarlo en el mismo PR) y confirmar la entrega en ambos canales.

**Bloqueado por**: insumo del PO (webhook URL) — el agente no puede crear el endpoint de Slack.

## Estado

Pendiente, bloqueado por insumo PO.
