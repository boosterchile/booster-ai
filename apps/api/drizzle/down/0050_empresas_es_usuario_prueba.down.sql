-- =============================================================================
-- REVERSE-SQL MANUAL — 0050_empresas_es_usuario_prueba (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio.
--
-- Revierte la migración 0050 (columna es_usuario_prueba). Data-safe: la columna
-- es un flag booleano; dropearla pierde la marca de empresas de prueba, pero no
-- hay dato de negocio irrecuperable. En prod preferí rollback de código (la
-- migración es aditiva → una revisión previa ignora la columna) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0050_empresas_es_usuario_prueba.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE empresas DROP COLUMN IF EXISTS es_usuario_prueba;
