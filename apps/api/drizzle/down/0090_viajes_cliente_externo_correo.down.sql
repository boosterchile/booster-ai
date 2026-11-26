-- REVERSE-SQL MANUAL — 0090_viajes_cliente_externo_correo
-- Expand-only: una columna nueva en viajes. Bajarla pierde los correos de
-- los clientes externos; los certificados ya emitidos no cambian.

ALTER TABLE viajes
  DROP COLUMN IF EXISTS cliente_externo_correo;
