-- ============================================================================
-- 0005_dispositivos_telemetria
--
-- Phase 2 — Pipeline Teltonika.
--
-- Agrega:
--   1. Enum estado_dispositivo_pendiente.
--   2. Tabla dispositivos_pendientes — IMEIs que conectaron al gateway
--      pero todavía no están asociados a un vehículo. El admin del
--      transportista los asocia desde el panel.
--   3. Tabla telemetria_puntos — uno por record AVL recibido. Alta
--      cardinalidad; indexes optimizados para queries por vehículo o
--      ventana de tiempo. JSONB para los IO entries (catalog-agnostic).
-- ============================================================================

-- 1. Enum del flujo de aprobación de un dispositivo nuevo.
CREATE TYPE "estado_dispositivo_pendiente" AS ENUM (
  'pendiente',
  'aprobado',
  'rechazado',
  'reemplazado'
);

-- 2. Tabla dispositivos_pendientes — buffer entre "device conecta" y
-- "admin asocia a un vehículo". El gateway hace upsert por IMEI cada
-- vez que un device se conecta sin asociación; `cantidad_conexiones`
-- es métrica para que el admin entienda actividad.
CREATE TABLE "dispositivos_pendientes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "imei" varchar(20) NOT NULL UNIQUE,
  "primera_conexion_en" timestamptz NOT NULL DEFAULT now(),
  "ultima_conexion_en" timestamptz NOT NULL DEFAULT now(),
  "ultima_ip_origen" inet,
  "cantidad_conexiones" integer NOT NULL DEFAULT 1,
  "modelo_detectado" varchar(50),
  "estado" "estado_dispositivo_pendiente" NOT NULL DEFAULT 'pendiente',
  "asignado_a_vehiculo_id" uuid REFERENCES "vehiculos"("id"),
  "asignado_en" timestamptz,
  "asignado_por_id" uuid REFERENCES "usuarios"("id"),
  "notas" text,
  "creado_en" timestamptz NOT NULL DEFAULT now(),
  "actualizado_en" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "idx_dispositivos_pendientes_estado" ON "dispositivos_pendientes"("estado");
CREATE INDEX "idx_dispositivos_pendientes_ultima_conexion" ON "dispositivos_pendientes"("ultima_conexion_en" DESC);

-- 3. Tabla telemetria_puntos — UN row por AVL record (un punto GPS).
-- Volumen estimado piloto: 1 record/min/device × 50 devices × 30 días ≈ 2.16M rows/mes.
-- Postgres es OK hasta ~10M rows con buenos indexes; migrar a BQ si flota crece.
--
-- Diseño:
--   - PK bigserial (rápido para inserts, eficiente para joins por id).
--   - UNIQUE (imei, timestamp_device): dedup natural si el gateway
--     reenvía un record por retry. El processor hace ON CONFLICT DO NOTHING.
--   - vehiculo_id FK con ON DELETE RESTRICT: no borrar vehículos con
--     telemetría asociada (auditoría ESG).
--   - io_data JSONB: catalog-agnostic. El parser entrega
--     {id: value} para todos los IO entries; el catalog semántico
--     vive en código (apps/api/src/services/io-catalog.ts).
CREATE TABLE "telemetria_puntos" (
  "id" bigserial PRIMARY KEY,
  "vehiculo_id" uuid NOT NULL REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  "imei" varchar(20) NOT NULL,
  "timestamp_device" timestamptz NOT NULL,
  "timestamp_recibido_en" timestamptz NOT NULL DEFAULT now(),
  "prioridad" smallint NOT NULL CHECK ("prioridad" IN (0, 1, 2)),
  "longitud" numeric(10, 7),
  "latitud" numeric(10, 7),
  "altitud_m" smallint,
  "rumbo_deg" smallint,
  "satelites" smallint,
  "velocidad_kmh" smallint,
  "event_io_id" integer,
  "io_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "uq_telemetria_imei_ts" UNIQUE ("imei", "timestamp_device")
);

CREATE INDEX "idx_telemetria_vehiculo_ts" ON "telemetria_puntos"("vehiculo_id", "timestamp_device" DESC);
CREATE INDEX "idx_telemetria_imei_ts" ON "telemetria_puntos"("imei", "timestamp_device" DESC);
-- Para queries de "última posición de cada vehículo" (top-N rápido):
CREATE INDEX "idx_telemetria_vehiculo_recibido" ON "telemetria_puntos"("vehiculo_id", "timestamp_recibido_en" DESC);
