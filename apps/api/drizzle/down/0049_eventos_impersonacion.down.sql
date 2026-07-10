-- =============================================================================
-- REVERSE-SQL MANUAL — 0049_eventos_impersonacion (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la migración 0049 (tabla de auditoría de impersonación). Data-safe
-- SOLO si no se quiere conservar el rastro de auditoría: dropear la tabla
-- pierde todos los eventos_impersonacion registrados. En prod preferí rollback
-- de código (la migración es aditiva → una revisión previa ignora la tabla) o
-- PITR; usar esto solo en dev/staging.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0049_eventos_impersonacion.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

DROP TABLE IF EXISTS "eventos_impersonacion";
