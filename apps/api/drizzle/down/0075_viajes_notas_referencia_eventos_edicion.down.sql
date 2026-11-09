-- =============================================================================
-- REVERSE-SQL MANUAL — 0075_viajes_notas_referencia_eventos_edicion (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte las columnas notas y referencia (se pierden los textos cargados).
-- Los valores agregados a tipo_evento_viaje NO se revierten: Postgres no
-- permite DROP VALUE, y eventos_viaje es append-only (puede haber filas con
-- esos valores). Un valor de enum sin uso es inerte.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0075_viajes_notas_referencia_eventos_edicion.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE "viajes" DROP CONSTRAINT IF EXISTS "ck_viajes_notas_largo";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "referencia";
ALTER TABLE "viajes" DROP COLUMN IF EXISTS "notas";
