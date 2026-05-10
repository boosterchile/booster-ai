-- Migration 0014 — Datos del consignee en trips (Phase 5 PR-L3b)
--
-- Agrega 2 columnas opcionales para que el shipper pueda capturar al
-- destinatario final de la carga al crear el trip:
--
--   destinatario_nombre       — para mostrar en saludo del template
--   destinatario_whatsapp_e164 — phone E.164 al que se envía el link
--                                público de tracking al asignar
--
-- Si ambos están presentes, notify-tracking-link.ts (PR-L3) envía el
-- WhatsApp DIRECTAMENTE al consignee. Si están NULL, fallback al
-- shipper (patrón v1 de PR-L3 — el shipper forwarda manualmente).
--
-- Por qué opt-in:
--   - Privacy: el shipper típico tiene la relación con su consignee
--     y prefiere NO compartir el número con la plataforma — solo
--     quien quiere la experiencia Uber-like llena estos campos.
--   - GDPR/Ley 19.628 Chile: capturar phone de un tercero requiere
--     base legal — el shipper actúa como controlador de los datos
--     del consignee (legitimate interest: notificar entrega).
--
-- Riesgo deploy: bajo. ADD COLUMN nullable = metadata-only en
-- Postgres ≥ 11. Reversible vía DROP COLUMN.

ALTER TABLE "viajes"
  ADD COLUMN "destinatario_nombre" varchar(100),
  ADD COLUMN "destinatario_whatsapp_e164" varchar(20);
