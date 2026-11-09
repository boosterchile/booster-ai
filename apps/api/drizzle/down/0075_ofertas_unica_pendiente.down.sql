-- =============================================================================
-- Revierte la migración 0075 (unicidad de ofertas solo para pendientes).
--
-- Solo es seguro si ningún par (viaje_id, empresa_id) tiene más de una oferta.
-- Después de un re-matching puede haberlos (una expirada y una pendiente para
-- la misma transportista) y el ADD CONSTRAINT falla. Verificar antes:
--
--   SELECT viaje_id, empresa_id, count(*) FROM ofertas
--   GROUP BY 1, 2 HAVING count(*) > 1;   -- debe dar 0 filas
--
-- En prod conviene el rollback de código: una revisión previa nunca crea dos
-- ofertas para el mismo par, así que convive con el índice parcial.
--
-- Aplicar a mano vía bastion en modo password (DDL):
--   AUTH_MODE=password bash scripts/db/connect.sh -f apps/api/drizzle/down/0075_ofertas_unica_pendiente.down.sql
--
-- ⚠️ NO actualiza drizzle.__drizzle_migrations: si la migración forward sigue en
--    el repo, el próximo startup la re-aplica. Parche puente, no undo permanente.
-- =============================================================================

ALTER TABLE ofertas
  ADD CONSTRAINT uq_ofertas_viaje_empresa UNIQUE (viaje_id, empresa_id);
DROP INDEX IF EXISTS uq_ofertas_viaje_empresa_pendiente;
