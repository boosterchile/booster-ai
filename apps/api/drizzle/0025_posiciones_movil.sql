-- Migration 0025 — Posiciones GPS de conductor via browser (D2)
--
-- Stream paralelo a `telemetria_puntos` (canal Teltonika) para vehículos
-- que NO tienen Teltonika asociado. El conductor envía su posición
-- desde el browser (Geolocation API) cada ~10s mientras está en /app/
-- conductor/modo durante una asignación activa.
--
-- Decisiones:
--
--   1. Tabla separada de `telemetria_puntos`:
--      Schema diferente (no hay imei/io_data/altitude/satellites), source
--      distinta (browser vs Teltonika), QPS distintos (~1/10s vs ~1/s
--      Teltonika). Mantener separadas evita pollution del schema histórico
--      y permite políticas de retención independientes.
--
--   2. FK opcional `asignacion_id`:
--      Nullable porque el flujo de "modo conductor" puede estar activo
--      sin asignación específica (driver navega, está en stand-by). En
--      ese caso lo reporta sin asignacion_id y el carrier sigue viendo
--      el vehículo en `/flota`.
--
--   3. `precision_m` opcional (numeric 8,2):
--      Algunos browsers reportan accuracy alta variabilidad. Si excede
--      ~50m la UI puede mostrar un radio gris en vez de un pin sólido.
--
--   4. Sin UNIQUE composite:
--      Permitir múltiples puntos en el mismo segundo (race). El consumer
--      hace ORDER BY timestamp_device DESC LIMIT 1.
--
-- Riesgo deploy: CREATE TABLE simple. Reversible con DROP.

CREATE TABLE "posiciones_movil_conductor" (
  "id" bigserial PRIMARY KEY,
  "asignacion_id" uuid,
  "vehiculo_id" uuid NOT NULL REFERENCES "vehiculos"("id") ON DELETE RESTRICT,
  "usuario_id" uuid NOT NULL REFERENCES "usuarios"("id") ON DELETE RESTRICT,
  "timestamp_device" timestamp with time zone NOT NULL,
  "timestamp_recibido_en" timestamp with time zone NOT NULL DEFAULT now(),
  "latitud" numeric(10, 7) NOT NULL,
  "longitud" numeric(10, 7) NOT NULL,
  "precision_m" numeric(8, 2),
  "velocidad_kmh" numeric(6, 2),
  "rumbo_deg" smallint,
  "fuente" varchar(20) NOT NULL DEFAULT 'browser'
);

CREATE INDEX "idx_posmovil_vehiculo_ts"
  ON "posiciones_movil_conductor" ("vehiculo_id", "timestamp_device");

CREATE INDEX "idx_posmovil_usuario_ts"
  ON "posiciones_movil_conductor" ("usuario_id", "timestamp_device");
