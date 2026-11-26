-- REVERSE-SQL MANUAL — 0091_solicitudes_booster
-- Expand-only: tabla nueva. Bajarla pierde las solicitudes a Booster, abiertas
-- y resueltas; ninguna otra tabla depende de ella.

DROP INDEX IF EXISTS idx_solicitudes_booster_empresa;
DROP INDEX IF EXISTS uq_solicitudes_booster_vehiculo_tipo_abierta;
DROP TABLE IF EXISTS solicitudes_booster;
