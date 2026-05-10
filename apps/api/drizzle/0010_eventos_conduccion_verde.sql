-- Migration 0010 — Eventos de conducción verde (Phase 2 PR-I2)
--
-- Tabla nueva para persistir los eventos green-driving + over-speeding
-- que el FMC150 emite vía IO 253/254/255. El telemetry-processor (PR-I2
-- siguiente, en apps/telemetry-processor) los extrae con
-- @booster-ai/codec8-parser/extractGreenDrivingEvents y los inserta
-- acá uno por uno (un AVL packet puede traer múltiples).
--
-- Por qué tabla aparte de telemetria_puntos:
--   - Cardinalidad muy distinta: puntos = ~1 ping cada 30s (millones
--     por mes); eventos = 5-50 por trip (~miles por mes). Mezclar rompe
--     planes de query.
--   - Semántica distinta: puntos son state-of-world (posición, velocidad);
--     eventos son transiciones discretas (frenazo, exceso). Indexes
--     diferentes.
--   - Driver scoring (PR-I3 siguiente) agrega solo desde acá; no quiere
--     ruido de los puntos periódicos.
--
-- Dedup: UNIQUE (vehiculo_id, timestamp_device, tipo). El reloj del FMC150
-- tiene resolución 1s, así que dos eventos del mismo tipo en el mismo
-- timestamp solo pueden venir de un retry del processor — el ON CONFLICT
-- DO NOTHING en el caller los descarta.
--
-- Riesgo deploy: bajo. CREATE TYPE + CREATE TABLE son metadata-only en
-- Postgres; no afectan tablas existentes. Reversible vía DROP TABLE +
-- DROP TYPE.

-- Enum nuevo
CREATE TYPE "tipo_evento_conduccion" AS ENUM (
  'aceleracion_brusca',
  'frenado_brusco',
  'curva_brusca',
  'exceso_velocidad'
);

-- Tabla nueva
CREATE TABLE "eventos_conduccion_verde" (
  "id" bigserial PRIMARY KEY,
  "vehiculo_id" uuid NOT NULL,
  "imei" varchar(20) NOT NULL,
  "timestamp_device" timestamptz NOT NULL,
  "timestamp_recibido_en" timestamptz NOT NULL DEFAULT now(),
  "tipo" tipo_evento_conduccion NOT NULL,
  "severidad" numeric(8, 2) NOT NULL,
  "unidad" varchar(8) NOT NULL,
  "latitud" numeric(10, 7),
  "longitud" numeric(10, 7),
  "velocidad_kmh" smallint,
  CONSTRAINT "fk_eventos_conduccion_vehiculo"
    FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  CONSTRAINT "uq_eventos_conduccion_vehiculo_ts_tipo"
    UNIQUE ("vehiculo_id", "timestamp_device", "tipo")
);

-- Index para queries de scoring por (vehículo, ventana de trip).
CREATE INDEX "idx_eventos_conduccion_vehiculo_ts"
  ON "eventos_conduccion_verde" ("vehiculo_id", "timestamp_device");

-- Index para analytics por tipo de evento (ej. "cuántos exceso_velocidad
-- este mes a nivel de flota").
CREATE INDEX "idx_eventos_conduccion_tipo_ts"
  ON "eventos_conduccion_verde" ("tipo", "timestamp_device");
