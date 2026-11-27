-- REVERSE-SQL MANUAL — 0093_cargas_combustible
-- Expand-only: tabla nueva. Bajarla pierde las cargas registradas, vigentes y
-- anuladas; ninguna otra tabla depende de ella.

DROP INDEX IF EXISTS idx_cargas_combustible_vehiculo_fecha;
DROP INDEX IF EXISTS uq_cargas_combustible_vigente;
DROP TABLE IF EXISTS cargas_combustible;
