-- =============================================================================
-- REVERSE-SQL MANUAL — 0045_facturas_membership_dunning (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la migración 0045 (columnas de dunning del cobro de membresías).
-- Data-safe SOLO si las columnas no contienen datos de cobranza que se quieran
-- conservar: dropearlas pierde `cobro_intentos` / `cobro_estado` / timestamps.
-- En prod preferí rollback de código (la migración es aditiva → una revisión
-- previa ignora estas columnas) o PITR; usar esto solo en dev/staging.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0045_facturas_membership_dunning.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

DROP INDEX IF EXISTS "idx_facturas_cobro_reintento";
ALTER TABLE facturas_booster_clp DROP CONSTRAINT IF EXISTS chk_facturas_cobro_estado;
ALTER TABLE facturas_booster_clp DROP COLUMN IF EXISTS cobro_gateway_ref;
ALTER TABLE facturas_booster_clp DROP COLUMN IF EXISTS cobro_proximo_intento_en;
ALTER TABLE facturas_booster_clp DROP COLUMN IF EXISTS cobro_ultimo_intento_en;
ALTER TABLE facturas_booster_clp DROP COLUMN IF EXISTS cobro_intentos;
ALTER TABLE facturas_booster_clp DROP COLUMN IF EXISTS cobro_estado;
