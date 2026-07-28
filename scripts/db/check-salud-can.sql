-- =============================================================================
-- Chequeo de SALUD CAN de la flota — read-only, sin dependencias.
-- =============================================================================
-- Uso:  scripts/db/agent-query.sh -f scripts/db/check-salud-can.sql
--
-- Responde tres preguntas que hoy nadie contesta automáticamente:
--   1. ¿Qué vehículos son CAN-capaces?     → emitieron algún ID 81-90 alguna vez
--   2. ¿Cuáles están emitiendo AHORA?      → ventana de 24 h
--   3. ¿Cuáles se degradaron o cayeron?    → capaces que hoy no emiten, o que
--                                             perdieron IDs respecto de su pico
--
-- Por qué "CAN-capaz observado" y no un flag de provisioning: un vehículo que
-- NUNCA emitió CAN (KZBB26, sin adaptador LV-CAN) no debe generar alerta — no
-- es una regresión, es una capacidad ausente. Derivarlo de la evidencia evita
-- la columna manual y el falso positivo permanente. Cuando exista el flag de
-- provisioning, este chequeo se reemplaza por él.
--
-- IDs relevantes (rango LVCAN del adaptador LV-CAN200/ALL-CAN300 vía RS232):
--   81 vehicle speed · 82 accel pedal · 83 FUEL CONSUMED (driver de CO2e)
--   84 fuel level L  · 85 engine RPM  · 87 total mileage · 89 fuel level %
--   90 (presente en cero en algunos devices — NO cuenta como CAN útil)
-- =============================================================================

WITH historico AS (
  -- Ventana de 30 días: suficiente para "¿alguna vez emitió?" sin escanear la
  -- tabla entera (el LATERAL sobre 400k+ filas se pasa del statement_timeout).
  SELECT tp.vehiculo_id,
         count(*) FILTER (WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']) AS pings_can_hist,
         max(tp.timestamp_device) FILTER (WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']) AS ultimo_can
  FROM telemetria_puntos tp
  WHERE tp.timestamp_device > now() - interval '30 days'
  GROUP BY tp.vehiculo_id
),
ventana AS (
  SELECT tp.vehiculo_id,
         count(*) AS pings_24h,
         count(*) FILTER (WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']) AS pings_can_24h,
         count(*) FILTER (WHERE tp.io_data ? '83') AS pings_fuel_24h,
         count(*) FILTER (WHERE tp.velocidad_kmh > 0) AS pings_movimiento_24h,
         count(*) FILTER (WHERE tp.velocidad_kmh > 0
                            AND NOT (tp.io_data ?| ARRAY['81','82','83','84','85','87','89'])) AS movimiento_sin_can
  FROM telemetria_puntos tp
  WHERE tp.timestamp_device > now() - interval '24 hours'
  GROUP BY tp.vehiculo_id
)
SELECT
  v.patente,
  v.marca || ' ' || v.modelo || ' ' || COALESCE(v.anio::text,'?') AS vehiculo,
  CASE
    WHEN COALESCE(h.pings_can_hist,0) = 0            THEN 'SIN CAPACIDAD CAN'
    WHEN COALESCE(w.pings_can_24h,0) = 0             THEN 'CAIDO'
    WHEN COALESCE(w.pings_fuel_24h,0) = 0            THEN 'DEGRADADO (sin ID 83 fuel)'
    WHEN w.movimiento_sin_can > w.pings_movimiento_24h / 2 THEN 'INTERMITENTE'
    ELSE 'OK'
  END AS estado_can,
  COALESCE(w.pings_24h,0)            AS pings_24h,
  COALESCE(w.pings_can_24h,0)        AS con_can_24h,
  COALESCE(w.pings_fuel_24h,0)       AS con_fuel83_24h,
  COALESCE(w.pings_movimiento_24h,0) AS en_mov_24h,
  COALESCE(w.movimiento_sin_can,0)   AS mov_sin_can,
  (h.ultimo_can AT TIME ZONE 'America/Santiago')::timestamp(0) AS ultimo_can_scl
FROM vehiculos v
LEFT JOIN historico h ON h.vehiculo_id = v.id
LEFT JOIN ventana   w ON w.vehiculo_id = v.id
WHERE v.teltonika_imei IS NOT NULL
ORDER BY
  CASE
    WHEN COALESCE(h.pings_can_hist,0) = 0 THEN 3
    WHEN COALESCE(w.pings_can_24h,0) = 0  THEN 0
    WHEN COALESCE(w.pings_fuel_24h,0) = 0 THEN 1
    ELSE 2
  END,
  v.patente;
