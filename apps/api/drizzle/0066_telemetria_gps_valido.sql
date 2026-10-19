-- 0066 — Última posición válida sin barrer pings sin fix.
--
-- Numeración: #793, #794 y #795 reservan 0063–0065 y todavía no están en
-- main. Este archivo es 0066 a propósito. Al mergear esos tres, el journal
-- tiene que dejar esta entrada con idx 66 (hoy entra en el hueco 63).
--
-- GET /vehiculos/:id/ubicacion pide el ping más nuevo con lat/lng distintas
-- de null y de 0. idx_telemetria_vehiculo_ts (y uq_telemetria_imei_ts en el
-- camino espejo) incluyen los 0,0. El plan camina desde el timestamp más
-- nuevo y lee el heap (io_data) hasta el primer fix: ~0,5 s si el último
-- ping ya vale, decenas de segundos si el equipo lleva horas sin GPS.
--
-- El índice parcial solo guarda filas válidas. LIMIT 1 es un salto.
-- Los pings 0,0 no entran, así que ese insert no paga una hoja extra.
-- CREATE INDEX (sin CONCURRENTLY): el migrator corre en transacción.
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
