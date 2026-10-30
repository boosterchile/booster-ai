-- =============================================================================
-- REVERSE-SQL MANUAL — 0065_usuarios_activacion_vence_en (ADR-066)
-- =============================================================================
-- ⚠️ MANUAL-APPLY-ONLY. El auto-migrator (src/db/migrator.ts) es forward-only y
--    NO lee este directorio. Esto NO es un down-migration auto-aplicado.
--
-- Revierte la migración 0065 (usuarios.activacion_vence_en). Dropearla deja
-- sin plazo los códigos pendientes del personal de Booster: esas personas no
-- podrán activar hasta que se les emita un código nuevo. En prod preferí
-- rollback de código (la migración es aditiva → una revisión previa ignora
-- la columna) o PITR.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0065_usuarios_activacion_vence_en.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE usuarios DROP COLUMN IF EXISTS activacion_vence_en;
