-- 0066 — Última posición válida sin barrer pings sin fix.
--
-- Numeración: #793, #794 y #795 reservan 0063–0065 y todavía no están en
-- main. Este archivo es 0066 a propósito. El idx del journal NO se mueve
-- en este PR: #799 se mergea último y ahí el idx pasa a 66.
--
-- GET /vehiculos/:id/ubicacion pide el ping más nuevo con lat/lng distintas
-- de null y de 0. idx_telemetria_vehiculo_ts (y uq_telemetria_imei_ts en el
-- camino espejo) incluyen los 0,0. El plan camina desde el timestamp más
-- nuevo y lee el heap (io_data) hasta el primer fix: ~0,5 s si el último
-- ping ya vale, decenas de segundos si el equipo lleva horas sin GPS.
--
-- El índice parcial solo guarda filas válidas. LIMIT 1 es un salto.
-- Los pings 0,0 no entran, así que ese insert no paga una hoja extra.
--
-- IF NOT EXISTS en los dos, con la misma lista de columnas y el mismo
-- WHERE. Si Ops ya los creó a mano (runbook, CONCURRENTLY), este paso
-- del migrator es un no-op: Postgres mira el nombre, no reescribe la
-- definición. Por eso el WHERE de abajo tiene que ser idéntico al del
-- runbook. Un índice INVALID con el mismo nombre también haría no-op y
-- el plan no lo usa: el runbook exige indisvalid = true antes del deploy.
--
-- CREATE INDEX (sin CONCURRENTLY): el migrator corre en transacción.
-- Runbook, con la verificación de indisvalid y el DROP de reintento:
-- docs/runbooks/indice-parcial-gps-0066.md
-- SQL exacto para copiar (misma definición y el mismo WHERE; va
-- CONCURRENTLY porque Ops lo corre fuera de la transacción del migrator):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_telemetria_vehiculo_gps_valido"
--     ON "telemetria_puntos" ("vehiculo_id", "timestamp_device" DESC)
--     WHERE "latitud" IS NOT NULL
--       AND "longitud" IS NOT NULL
--       AND "latitud" <> 0
--       AND "longitud" <> 0;
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_telemetria_imei_gps_valido"
--     ON "telemetria_puntos" ("imei", "timestamp_device" DESC)
--     WHERE "latitud" IS NOT NULL
--       AND "longitud" IS NOT NULL
--       AND "latitud" <> 0
--       AND "longitud" <> 0;
--
-- Rollback manual: drizzle/down/0066_telemetria_gps_valido.down.sql
CREATE INDEX IF NOT EXISTS "idx_telemetria_vehiculo_gps_valido"
  ON "telemetria_puntos" ("vehiculo_id", "timestamp_device" DESC)
  WHERE "latitud" IS NOT NULL
    AND "longitud" IS NOT NULL
    AND "latitud" <> 0
    AND "longitud" <> 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_telemetria_imei_gps_valido"
  ON "telemetria_puntos" ("imei", "timestamp_device" DESC)
  WHERE "latitud" IS NOT NULL
    AND "longitud" IS NOT NULL
    AND "latitud" <> 0
    AND "longitud" <> 0;
