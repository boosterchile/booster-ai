-- =============================================================================
-- REVERSE-SQL MANUAL — 0051_vehiculos_tiene_sensor_temperatura (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio.
--
-- Revierte la migración 0051 (columna tiene_sensor_temperatura). Data-safe: es
-- un flag booleano de provisioning; dropearlo pierde qué vehículos tienen sonda
-- cableada, pero no hay dato de negocio irrecuperable (se re-marca). En prod
-- preferí rollback de código (la migración es aditiva → una revisión previa
-- ignora la columna) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0051_vehiculos_tiene_sensor_temperatura.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE vehiculos DROP COLUMN IF EXISTS tiene_sensor_temperatura;
