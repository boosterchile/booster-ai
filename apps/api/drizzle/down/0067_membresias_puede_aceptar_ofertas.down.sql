-- =============================================================================
-- REVERSE-SQL MANUAL — 0067_membresias_puede_aceptar_ofertas (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la columna `membresias.puede_aceptar_ofertas`. Data-safe mientras
-- nadie haya prendido el flag: dropearla pierde qué despachadores pueden
-- aceptar ofertas. En prod preferí rollback de código (la migración es
-- aditiva → una revisión previa ignora la columna) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0067_membresias_puede_aceptar_ofertas.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE "membresias" DROP COLUMN IF EXISTS "puede_aceptar_ofertas";
