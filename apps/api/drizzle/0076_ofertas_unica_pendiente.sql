-- Migration 0076 — unicidad de ofertas solo para las pendientes.
--
-- editar-anular-cargas M2. CONTRACT aprobado por el PO el 2026-11-09 (§12-P1).
-- Tras una edición material antes del match, las ofertas pendientes pasan a
-- `expirada` y el re-matching vuelve a ofertar, también a la misma
-- transportista y a quien rechazó. Con `uq_ofertas_viaje_empresa` sobre todas
-- las filas ese INSERT aborta la tx del matching.
--
-- No toca datos. El índice parcial es más laxo que la restricción que
-- reemplaza: toda fila que hoy cumple una, cumple la otra. La unicidad de la
-- oferta aceptada la siguen dando asignaciones.viaje_id y asignaciones.oferta_id
-- UNIQUE.
--
-- contract-phase: .specs/editar-anular-cargas (M2, §12-P1)

CREATE UNIQUE INDEX uq_ofertas_viaje_empresa_pendiente
  ON ofertas (viaje_id, empresa_id) WHERE estado = 'pendiente';
--> statement-breakpoint
ALTER TABLE ofertas DROP CONSTRAINT uq_ofertas_viaje_empresa;
