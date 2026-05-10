-- Migration 0013 — Idempotencia delivery WhatsApp del coaching IA (Phase 3 PR-J3)
--
-- Agrega 1 columna a metricas_viaje:
--
--   coaching_whatsapp_enviado_en — timestamp de cuando el template
--     `coaching_post_entrega_v1` fue despachado al dueño del transportista
--     (whatsapp_e164). NULL si todavía no se envió o si la config Twilio
--     no estaba seteada.
--
-- ¿Por qué columna y no tabla de eventos?
--   notify-coaching es 1-shot por trip post-entrega. La idempotencia se
--   logra con UPDATE ... WHERE coaching_whatsapp_enviado_en IS NULL
--   (mismo patrón que offers.notificado_en y chat_messages.whatsapp_notif_enviado_en).
--   No necesitamos historial de re-intentos para esta surface.
--
-- Riesgo deploy: bajo. ADD COLUMN nullable es metadata-only en Postgres ≥ 11.
-- Reversible vía DROP COLUMN.

ALTER TABLE "metricas_viaje"
  ADD COLUMN "coaching_whatsapp_enviado_en" timestamptz;
