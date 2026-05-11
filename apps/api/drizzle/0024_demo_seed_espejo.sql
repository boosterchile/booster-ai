-- Migration 0024 — IMEI espejo + flag is_demo (D1)
--
-- Dos cambios coherentes para el seed demo en producción:
--
-- 1. `vehiculos.teltonika_imei_espejo` (varchar 20, nullable):
--    Permite que un vehículo "mire" la telemetría de OTRO vehículo físico
--    sin contaminar datos ni romper FK. Los endpoints de lectura
--    (/ubicacion, /flota, /telemetria) filtran `telemetria_puntos.imei`
--    en lugar de `vehiculo_id` cuando este campo está setado.
--
--    Caso de uso: el carrier demo muestra los datos reales del Teltonika
--    de Van Oosterwyk en un vehículo sintético, mientras Van Oosterwyk
--    sigue siendo el "dueño primary" del device y su data permanece
--    intacta en su vehículo VFZH-68.
--
--    Mutuamente excluyente con `teltonika_imei`: un vehículo o tiene
--    device propio (escribe) o mira un IMEI ajeno (lee). Sin trigger
--    a nivel BD; validado en runtime.
--
-- 2. `empresas.es_demo` (boolean, default false):
--    Marca empresas creadas por el seed demo. Permite:
--    - Filtrar de métricas/billing (`WHERE es_demo = false`).
--    - Limpieza de un solo paso via DELETE cascada por FK (vehículos,
--      conductores, sucursales, asignaciones de la empresa demo se borran
--      al borrar la empresa, si los FK están configurados ON DELETE
--      CASCADE — sino el DELETE FROM admin/seed/demo hace la cascada
--      manualmente).
--
-- Riesgo deploy: ADD COLUMN nullable + ADD COLUMN con DEFAULT false son
-- ambas metadata-only en PG ≥ 11 (sin reescribir tabla). Reversibles.

ALTER TABLE "vehiculos" ADD COLUMN "teltonika_imei_espejo" varchar(20);

CREATE INDEX "idx_vehiculos_espejo_imei"
  ON "vehiculos" ("teltonika_imei_espejo")
  WHERE "teltonika_imei_espejo" IS NOT NULL;

ALTER TABLE "empresas" ADD COLUMN "es_demo" boolean NOT NULL DEFAULT false;
