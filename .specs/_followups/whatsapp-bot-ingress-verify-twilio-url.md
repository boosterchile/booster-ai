# Follow-up: endurecer ingress del whatsapp-bot (verificar URL de Twilio)

**Origen**: review de seguridad del ciclo feat-cloud-run-ingress-internal-lb (2026-06-14, MEDIA). Derivado de ADR-062.
**Prioridad**: P2.

## Contexto

El bot es `public=true`, tiene NEG+backend en el GCLB y la url_map rutea `/webhooks/whatsapp*` a su backend (networking.tf:390-401), con regla ALLOW `/webhooks/*` en Cloud Armor (networking.tf:241-250). El repo YA provisiona `TWILIO_WEBHOOK_URL = api.boosterchile.com/webhooks/whatsapp` (compute.tf:580) — el dominio GCLB, no el run.app. Es decir, el camino para endurecer el ingress del bot a `INTERNAL_LOAD_BALANCER` está casi listo.

## Bloqueador

La URL real que Twilio usa para postear el webhook vive en la **consola de Twilio** (Sender Inbound URL), fuera del repo. Si Twilio postea al run.app del bot en vez de al dominio, endurecer rompería la ingesta de WhatsApp. Además la firma X-Twilio-Signature se computa sobre la URL exacta → debe coincidir.

## Acción

1. Confirmar en la consola de Twilio que el Inbound URL (y el status callback) = `https://api.boosterchile.com/webhooks/whatsapp` (no run.app).
2. Confirmar que `TWILIO_WEBHOOK_URL` matchea exactamente (firma).
3. `ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"` en `module.service_whatsapp_bot` (compute.tf).
4. Smoke: mensaje de WhatsApp real → 200; `curl` directo al run.app del bot desde fuera → rechazado.

## Estado
**RESUELTO (código) — ADR-063 / feat-ingress-posture-round-2 (2026-06-14)**: `service_whatsapp_bot` → INTERNAL_LOAD_BALANCER en compute.tf. Falta solo la confirmación empírica del PO en la ventana (enviar un WhatsApp real → 200; el run.app del bot rechazado). Evidencia indirecta de que Twilio usa el dominio GCLB: la firma X-Twilio-Signature ya valida contra TWILIO_WEBHOOK_URL=api.boosterchile.com en prod.
