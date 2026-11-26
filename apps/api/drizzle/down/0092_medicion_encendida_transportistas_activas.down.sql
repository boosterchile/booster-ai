-- REVERSE-SQL MANUAL — 0092_medicion_encendida_transportistas_activas
-- Devuelve a false la medición de las empresas que encendió la 0092 (y solo
-- esas) y borra su registro. Si una empresa la apagó o encendió a mano después,
-- la reversa igual la deja en false: es el valor que tenía antes de la 0092.

UPDATE empresas
   SET carbon_measurement_enabled = false
 WHERE id IN (SELECT empresa_id FROM empresas_medicion_encendida_0092);

DROP TABLE IF EXISTS empresas_medicion_encendida_0092;
