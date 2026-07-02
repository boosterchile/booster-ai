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

✅ **CÓDIGO RESUELTO** (verificado en `main`, 2026-06-22) — el wiring del 2º canal
**ya existe** (el stub es de la auditoría 06-09, anterior al "sed global 2026-06-11"):

- `infrastructure/monitoring.tf:10-21` define `google_monitoring_notification_channel.sre_webhook`
  (`webhook_tokenauth`), **count-gated** a `var.sre_webhook_url != ""` → sin URL no se
  crea nada (email-only, consistente con la decisión #470).
- `monitoring.tf:25-30` lo concatena en `local.alert_channel_ids`, el local **único** que
  referencian **todas** las alert policies (P0 crash, telemetry-stall, cost-guardrails, etc.).
  Agregar el canal = ya está; activarlo propaga a todas.

**Único pendiente (no es código)**: el PO setea `var.sre_webhook_url = "<Slack/Telegram webhook>"`
en el tfvars + `terraform apply` (count pasa a 1 → el canal se crea inactivo→activo en todas
las policies) + dispara una alerta de prueba (paso 3). El secret shell `sre-notification-webhook`
quedó vestigial (la implementación usa la var directamente en `labels.url`).
