-- =============================================================================
-- REVERSE-SQL MANUAL — 0056_empresas_umbrales_robo_combustible (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio.
--
-- Revierte la migración 0056 (umbrales de robo de combustible). Data-safe en
-- el sentido de que dropear las columnas pierde solo la configuración; el
-- cálculo vuelve al default de dominio. En prod preferí rollback de código
-- (la migración es aditiva) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0056_empresas_umbrales_robo_combustible.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_umbral_robo_hormiga_l_rango;
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_umbral_robo_golpe_l_rango;
ALTER TABLE empresas DROP COLUMN IF EXISTS umbral_robo_hormiga_l;
ALTER TABLE empresas DROP COLUMN IF EXISTS umbral_robo_golpe_l;
