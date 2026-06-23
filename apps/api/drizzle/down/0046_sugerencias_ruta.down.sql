-- =============================================================================
-- REVERSE-SQL MANUAL — 0046_sugerencias_ruta (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la migración 0046 (tabla sugerencias_ruta + sus índices).
-- Data-safe SOLO si la tabla no contiene sugerencias que se quieran conservar:
-- DROP TABLE elimina todos los datos. En prod preferir rollback de código
-- (la migración es aditiva → una revisión previa ignora esta tabla) o PITR;
-- usar esto solo en dev/staging con datos prescindibles.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0046_sugerencias_ruta.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

DROP INDEX IF EXISTS idx_sugerencias_ruta_adopcion_pendiente;
DROP INDEX IF EXISTS idx_sugerencias_ruta_viaje;
DROP TABLE IF EXISTS sugerencias_ruta;
