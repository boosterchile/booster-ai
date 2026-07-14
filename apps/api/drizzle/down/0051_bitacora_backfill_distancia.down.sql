-- =============================================================================
-- REVERSE-SQL MANUAL — 0051_bitacora_backfill_distancia (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Dropea la bitácora de reversibilidad del backfill F0-0. Data-safe SOLO si ya
-- no se necesita el camino de vuelta: dropear pierde el before-state de todos
-- los trips reescritos por el backfill. Este DROP es también el RETIRO planeado
-- de la tabla una vez consolidado el backfill (ver header de la forward + ADR).
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0051_bitacora_backfill_distancia.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Para el RETIRO definitivo, quitar
--    también la forward + la entrada de meta/_journal.json + la tabla del schema.
-- =============================================================================

DROP TABLE IF EXISTS "bitacora_backfill_distancia";
