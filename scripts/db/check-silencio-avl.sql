-- =============================================================================
-- Chequeo de SILENCIO AVL — read-only, extensión de check-salud-can.sql
-- =============================================================================
-- Uso:  STATEMENT_TIMEOUT_S=120 bash scripts/db/agent-query.sh -f scripts/db/check-silencio-avl.sql
--
-- Definición: silencio = I/O permanente que el vehículo YA demostró emitir
-- (capacidad observada en 30 d) y que deja de aparecer en io_data aunque
-- siga habiendo pings. No alerta por capacidad nunca vista. No alerta por
-- eventales (247, 249–255, 175, …).
--
-- Ajustes vs censo 2026-09-23 (Data Ops):
--   - ID 83 (fuel consumed): solo vehículos que emitieron 83 en 30 d.
--     JLKT54/JWTH77 NUNCA tuvieron 83 → no son CAIDO fuel.
--   - ID 84 (fuel level L): solo vehículos que emitieron 84 en 30 d (hoy JLKT54).
--   - ID 72 (Dallas): NO entra en v1. En flota viene siempre presente = 0
--     (placeholder) y tiene_sensor_temperatura=false.
--   - CAN núcleo (81/85/89): vehículos con algún CAN útil 81–89 (sin 90 solo).
--
-- Salida: SOLO filas en alerta (CAIDO / DEGRADADO / OFFLINE). Silencio OK = 0 rows.
-- =============================================================================

WITH historico AS (
  SELECT
    tp.vehiculo_id,
    count(*) FILTER (
      WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']
    ) AS pings_can_hist,
    count(*) FILTER (WHERE tp.io_data ? '83') AS pings_83_hist,
    count(*) FILTER (WHERE tp.io_data ? '84') AS pings_84_hist,
    max(tp.timestamp_device) FILTER (
      WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']
    ) AS ultimo_can,
    max(tp.timestamp_device) FILTER (WHERE tp.io_data ? '83') AS ultimo_83,
    max(tp.timestamp_device) FILTER (WHERE tp.io_data ? '84') AS ultimo_84
  FROM telemetria_puntos tp
  WHERE tp.timestamp_device > now() - interval '30 days'
  GROUP BY tp.vehiculo_id
),
ventana AS (
  SELECT
    tp.vehiculo_id,
    count(*) AS pings_24h,
    count(*) FILTER (
      WHERE tp.io_data ?| ARRAY['81','82','83','84','85','87','89']
    ) AS pings_can_24h,
    count(*) FILTER (WHERE tp.io_data ? '81') AS pings_81_24h,
    count(*) FILTER (WHERE tp.io_data ? '83') AS pings_83_24h,
    count(*) FILTER (WHERE tp.io_data ? '84') AS pings_84_24h,
    count(*) FILTER (WHERE tp.io_data ? '85') AS pings_85_24h,
    count(*) FILTER (WHERE tp.io_data ? '89') AS pings_89_24h,
    max(tp.timestamp_device) AS ultimo_ping
  FROM telemetria_puntos tp
  WHERE tp.timestamp_device > now() - interval '24 hours'
  GROUP BY tp.vehiculo_id
),
clasificado AS (
  SELECT
    v.patente,
    v.teltonika_imei,
    CASE
      WHEN COALESCE(w.pings_24h, 0) = 0
           AND EXISTS (
             SELECT 1 FROM telemetria_puntos tpx
             WHERE tpx.vehiculo_id = v.id
               AND tpx.timestamp_device > now() - interval '7 days'
             LIMIT 1
           )
        THEN 'OFFLINE_24H'
      WHEN COALESCE(h.pings_can_hist, 0) > 0
           AND COALESCE(w.pings_24h, 0) > 0
           AND COALESCE(w.pings_can_24h, 0) = 0
        THEN 'CAIDO_CAN'
      WHEN COALESCE(h.pings_83_hist, 0) > 0
           AND COALESCE(w.pings_24h, 0) > 0
           AND COALESCE(w.pings_83_24h, 0) = 0
        THEN 'DEGRADADO_SIN_83'
      WHEN COALESCE(h.pings_84_hist, 0) > 0
           AND COALESCE(w.pings_24h, 0) > 0
           AND COALESCE(w.pings_84_24h, 0) = 0
        THEN 'DEGRADADO_SIN_84'
      WHEN COALESCE(h.pings_can_hist, 0) > 0
           AND COALESCE(w.pings_24h, 0) > 0
           AND (
             COALESCE(w.pings_81_24h, 0) = 0
             OR COALESCE(w.pings_85_24h, 0) = 0
             OR COALESCE(w.pings_89_24h, 0) = 0
           )
           AND COALESCE(w.pings_can_24h, 0) > 0
        THEN 'DEGRADADO_CAN_PARCIAL'
      ELSE NULL
    END AS alerta,
    COALESCE(w.pings_24h, 0) AS pings_24h,
    COALESCE(w.pings_can_24h, 0) AS con_can_24h,
    COALESCE(w.pings_83_24h, 0) AS con_83_24h,
    COALESCE(w.pings_84_24h, 0) AS con_84_24h,
    COALESCE(h.pings_83_hist, 0) > 0 AS capaz_83,
    COALESCE(h.pings_84_hist, 0) > 0 AS capaz_84,
    COALESCE(h.pings_can_hist, 0) > 0 AS capaz_can,
    (h.ultimo_can AT TIME ZONE 'America/Santiago')::timestamp(0) AS ultimo_can_scl,
    (h.ultimo_83 AT TIME ZONE 'America/Santiago')::timestamp(0) AS ultimo_83_scl,
    (h.ultimo_84 AT TIME ZONE 'America/Santiago')::timestamp(0) AS ultimo_84_scl,
    (w.ultimo_ping AT TIME ZONE 'America/Santiago')::timestamp(0) AS ultimo_ping_scl
  FROM vehiculos v
  LEFT JOIN historico h ON h.vehiculo_id = v.id
  LEFT JOIN ventana w ON w.vehiculo_id = v.id
  WHERE v.teltonika_imei IS NOT NULL
)
SELECT
  patente,
  teltonika_imei,
  alerta,
  pings_24h,
  con_can_24h,
  con_83_24h,
  con_84_24h,
  capaz_can,
  capaz_83,
  capaz_84,
  ultimo_ping_scl,
  ultimo_can_scl,
  ultimo_83_scl,
  ultimo_84_scl
FROM clasificado
WHERE alerta IS NOT NULL
ORDER BY
  CASE alerta
    WHEN 'CAIDO_CAN' THEN 0
    WHEN 'OFFLINE_24H' THEN 1
    WHEN 'DEGRADADO_SIN_83' THEN 2
    WHEN 'DEGRADADO_SIN_84' THEN 3
    WHEN 'DEGRADADO_CAN_PARCIAL' THEN 4
    ELSE 9
  END,
  patente;
