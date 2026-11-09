-- Migration 0073 — Enlace de seguimiento por correo (spec seguimiento-por-correo).
--
-- viajes.destinatario_email: correo opcional del destinatario, para enviarle
-- el enlace de seguimiento al asignar la carga.
-- asignaciones.tracking_link_email_enviado_en: idempotencia del correo,
-- independiente de la del WhatsApp.
-- asignaciones.tracking_link_enviado_en: idempotencia del WhatsApp que
-- notify-tracking-link.ts describía pero que no existía en el schema.
--
-- Expand-only: columnas nuevas nulas, sin default ni backfill.

ALTER TABLE "viajes" ADD COLUMN IF NOT EXISTS "destinatario_email" varchar(254);
ALTER TABLE "asignaciones" ADD COLUMN IF NOT EXISTS "tracking_link_email_enviado_en" timestamp with time zone;
ALTER TABLE "asignaciones" ADD COLUMN IF NOT EXISTS "tracking_link_enviado_en" timestamp with time zone;
