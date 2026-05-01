-- Migración 0003 — Notificaciones de oferta WhatsApp (Slice B.8.a).
--
-- Agrega:
--   - users.whatsapp_e164: número WhatsApp del usuario en formato E.164
--     (ej. +56912345678). Nullable porque los usuarios viejos no lo
--     declararon, y la captura es opcional al onboarding (puede completarse
--     después desde el perfil). Validación de formato vive en zod —
--     mantener la columna sin CHECK constraint para no rebotar inserts si
--     un legacy script intenta poblarla con datos imperfectos.
--
--   - offers.notified_at: marca de tiempo en la que el dispatcher de
--     notificaciones envió el WhatsApp al carrier. Nullable: null = aún
--     no se notificó (o falló silenciosamente). Sirve como guard de
--     idempotencia para no re-disparar si runMatching se reintenta.
--
-- Idempotencia: ALTER TABLE ... ADD COLUMN IF NOT EXISTS para soportar
-- reruns en dev contra DBs que ya tienen la columna.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_e164" varchar(20);--> statement-breakpoint

ALTER TABLE "offers" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;--> statement-breakpoint

-- Índice parcial para queries del dispatcher de retries:
-- "ofertas pending sin notificación todavía".
CREATE INDEX IF NOT EXISTS "idx_offers_notified_at"
  ON "offers" ("notified_at")
  WHERE "notified_at" IS NULL AND "status" = 'pending';
