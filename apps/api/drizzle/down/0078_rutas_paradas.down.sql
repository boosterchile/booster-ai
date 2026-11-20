-- Reverso MANUAL de 0078 (el migrator es forward-only, ADR-066).
-- Borra las rutas, sus paradas y sus eventos. Solo es seguro mientras ningún
-- lector dependa de la ruta (antes de la parte 4 de ruta-parada-servicio).

DROP INDEX IF EXISTS "idx_asignaciones_ruta";
ALTER TABLE "asignaciones" DROP CONSTRAINT IF EXISTS "asignaciones_ruta_id_rutas_id_fk";
ALTER TABLE "asignaciones" DROP COLUMN IF EXISTS "ruta_id";
DROP TABLE IF EXISTS "eventos_ruta";
DROP TABLE IF EXISTS "paradas_ruta";
DROP TABLE IF EXISTS "rutas";
DROP TYPE IF EXISTS "tipo_parada";
DROP TYPE IF EXISTS "estado_ruta";
