-- =============================================================================
-- REVERSE-SQL MANUAL — 0057_vehiculos_estanque_fuente_can (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio.
--
-- Revierte la migración 0057. Dropea capacidad y fuente CAN. El cálculo
-- vuelve a no conocer el estanque. En prod preferí rollback de código
-- (la migración es aditiva) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0057_vehiculos_estanque_fuente_can.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS chk_vehiculos_fuente_combustible_can;
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS chk_vehiculos_capacidad_estanque_l;
ALTER TABLE vehiculos DROP COLUMN IF EXISTS fuente_combustible_can;
ALTER TABLE vehiculos DROP COLUMN IF EXISTS capacidad_estanque_l;
