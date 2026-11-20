-- Reverso MANUAL de 0079 (el migrator es forward-only, ADR-066).
--
-- Solo es seguro mientras no exista ninguna asignación sin vehículo ni
-- ninguna unidad de tercero (antes de la parte 4 de matching-desde-la-carga).
-- Comprobar antes de correrlo:
--   SELECT count(*) FROM asignaciones WHERE vehiculo_id IS NULL;   -- debe ser 0
--   SELECT count(*) FROM vehiculos WHERE es_de_tercero;            -- debe ser 0
-- Con filas en cualquiera de las dos, el SET NOT NULL falla o se pierde la
-- marca de tercero.

ALTER TABLE "vehiculos" DROP COLUMN IF EXISTS "es_de_tercero";
ALTER TABLE "asignaciones" ALTER COLUMN "vehiculo_id" SET NOT NULL;
