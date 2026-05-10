-- Migration 0009 — Modelo dual de fuente de datos (ADR-028)
--
-- Implementa el schema de "fuente de datos del viaje" para distinguir
-- entre clientes con Teltonika (datos primarios verificables) y clientes
-- sin Teltonika (datos secundarios estimados). Selecciona el template
-- de certificado: cert-primario.html vs report-secundario.html.
--
-- Sin este modelo, el cert generator no puede distinguir niveles de
-- certificación → riesgo de greenwashing accidental al emitir certs
-- "verificables" sobre trips sin telemetría real suficiente.
--
-- Cambios:
--   1. Dos enums nuevos: fuente_dato_ruta y nivel_certificacion.
--   2. Cuatro columnas nuevas en metricas_viaje: route_data_source,
--      coverage_pct, certification_level, uncertainty_factor.
--   3. Backfill de filas legacy a partir del campo `fuente_datos`
--      (legacy text varchar) hacia los nuevos enums.
--
-- Riesgo de despliegue: bajo. CREATE TYPE + ADD COLUMN nullable es
-- metadata-only en Postgres ≥ 11; sin re-write de filas existentes.
-- El backfill UPDATE toca solo metricas_viaje, tabla con cardinalidad
-- baja (1:1 con viajes). Reversible vía DROP de columnas + DROP TYPE.
--
-- Postergado: drop del campo legacy `fuente_datos` (varchar 20). Queda
-- nullable para no romper código que aún lo lea durante la transición;
-- migración posterior lo elimina cuando todo el código consumidor pase
-- a leer route_data_source. Ver ADR-028 §1.

-- Enums nuevos
CREATE TYPE "fuente_dato_ruta" AS ENUM (
  'teltonika_gps',
  'maps_directions',
  'manual_declared'
);

CREATE TYPE "nivel_certificacion" AS ENUM (
  'primario_verificable',
  'secundario_modeled',
  'secundario_default'
);

-- Columnas nuevas en metricas_viaje (todas nullable inicialmente para
-- no fallar la migración en filas existentes; se pueblan por backfill
-- y luego por el flujo normal del carbon-calculator al cierre de cada
-- trip).
ALTER TABLE "metricas_viaje"
  ADD COLUMN "fuente_dato_ruta" "fuente_dato_ruta",
  ADD COLUMN "cobertura_pct" numeric(5, 2),
  ADD COLUMN "nivel_certificacion" "nivel_certificacion",
  ADD COLUMN "factor_incertidumbre" numeric(4, 3);

-- Backfill desde el campo legacy `fuente_datos` (varchar 20).
--
-- Mapeo del enum legacy al nuevo enum:
--   canbus     → teltonika_gps + cobertura 100% (asumimos full coverage
--                porque históricamente no fue tracked; el cálculo previo
--                ya usó esos datos como primarios)
--   modeled    → maps_directions + cobertura 0 (sin telemetría real)
--   driver_app → manual_declared + cobertura 0 (declaración del cliente)
--   NULL       → NULL en ambas columnas (sin info, queda para el próximo
--                cálculo de carbon-calculator)
--
-- certification_level y uncertainty_factor NO se backfillean acá. Se
-- poblarán cuando el cron `recalcular-metricas-viaje` corra sobre cada
-- viaje (ver apps/api/src/services/calcular-metricas-viaje.ts en el PR-F).
-- Esto evita tener que replicar la matriz de derivación en SQL puro.

UPDATE "metricas_viaje"
SET
  "fuente_dato_ruta" = CASE "fuente_datos"
    WHEN 'canbus' THEN 'teltonika_gps'::"fuente_dato_ruta"
    WHEN 'modeled' THEN 'maps_directions'::"fuente_dato_ruta"
    WHEN 'driver_app' THEN 'manual_declared'::"fuente_dato_ruta"
    ELSE NULL
  END,
  "cobertura_pct" = CASE "fuente_datos"
    WHEN 'canbus' THEN 100
    WHEN 'modeled' THEN 0
    WHEN 'driver_app' THEN 0
    ELSE NULL
  END
WHERE "fuente_datos" IS NOT NULL;

-- Index para queries por nivel de certificación (analytics, dashboard
-- admin de cuántos certs primarios vs secundarios se han emitido).
CREATE INDEX "idx_metricas_viaje_nivel_certificacion"
  ON "metricas_viaje" ("nivel_certificacion");
