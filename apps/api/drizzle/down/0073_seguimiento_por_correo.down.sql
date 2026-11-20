-- =============================================================================
-- REVERSE-SQL MANUAL — 0073_seguimiento_por_correo (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte las tres columnas. Pierde los correos de destinatario cargados y
-- las marcas de envío (un despacho posterior podría reenviar el enlace). En
-- prod preferí rollback de código: la migración es aditiva.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0073_seguimiento_por_correo.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "tracking_link_enviado_en";
ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "tracking_link_email_enviado_en";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "destinatario_email";
