-- Migration 0090 — viajes.cliente_externo_correo: correo opcional del cliente
-- externo de un viaje propio del transportista.
-- Spec: .specs/frente2-cierre/spec.md §3.3 (decisión D2 del PO, 2026-11-26).
--
-- El certificado de un viaje propio con cliente externo queda bajo la
-- transportista, que puede enviárselo por correo a ese cliente.
--
-- Expand-only (ADR-066): ADD COLUMN anulable, sin valor por defecto ni
-- reescritura de filas. Una revisión previa del api ignora la columna.
-- Reverse manual en drizzle/down/0090_viajes_cliente_externo_correo.down.sql.

ALTER TABLE viajes
  ADD COLUMN IF NOT EXISTS cliente_externo_correo varchar(254);
--> statement-breakpoint

COMMENT ON COLUMN viajes.cliente_externo_correo IS
  'Correo del cliente externo de un viaje propio (opcional). La transportista le envía el certificado ahí.';
