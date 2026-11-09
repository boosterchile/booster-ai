-- =============================================================================
-- REVERSE-SQL MANUAL — 0072_instrucciones_retiro (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la tabla `instrucciones_retiro`. Pierde las instrucciones cargadas
-- (los archivos quedan en el bucket hasta su ciclo de vida de 90 días). En
-- prod preferí rollback de código: la migración es aditiva y una revisión
-- previa ignora la tabla.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0072_instrucciones_retiro.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

DROP TABLE IF EXISTS "instrucciones_retiro";
