-- Reverso MANUAL de 0080 (el migrator es forward-only, ADR-066).
--
-- Borra las métricas de las rutas y los datos de reparto de los viajes. Solo
-- es seguro mientras ningún certificado se haya emitido con reparto (antes de
-- la parte 4 de huella-consolidada). Comprobar antes de correrlo:
--   SELECT count(*) FROM metricas_ruta;                              -- debe ser 0
--   SELECT count(*) FROM metricas_viaje WHERE ruta_id IS NOT NULL;   -- debe ser 0

DROP INDEX IF EXISTS "idx_metricas_viaje_ruta";
ALTER TABLE "metricas_viaje" DROP CONSTRAINT IF EXISTS "ck_metricas_viaje_participacion";
ALTER TABLE "metricas_viaje" DROP CONSTRAINT IF EXISTS "ck_metricas_viaje_actividad";
ALTER TABLE "metricas_viaje" DROP CONSTRAINT IF EXISTS "metricas_viaje_ruta_id_rutas_id_fk";
ALTER TABLE "metricas_viaje" DROP COLUMN IF EXISTS "version_metodo_reparto";
ALTER TABLE "metricas_viaje" DROP COLUMN IF EXISTS "participacion";
ALTER TABLE "metricas_viaje" DROP COLUMN IF EXISTS "actividad_tkm";
ALTER TABLE "metricas_viaje" DROP COLUMN IF EXISTS "ruta_id";
DROP TABLE IF EXISTS "metricas_ruta";
