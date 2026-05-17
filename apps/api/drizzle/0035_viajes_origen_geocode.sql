-- Migration 0035 — Viajes origen geocode (D11 / ADR-041 — T8 gap resolution).
--
-- Agrega `origen_lat` y `origen_lng` (nullable) a `viajes` para que el
-- endpoint /stakeholder/zonas pueda filtrar trips por bounding box de zona.
-- Spec §riesgos ya acepta null geocode ("zona simplemente no la cuenta").
--
-- Backfill de viajes históricos: queda como spec separada (Geocoding API
-- + cron). Hoy todos los viajes existentes parten en NULL; la UI los
-- muestra como `insufficient_data: true` hasta que el backfill corra.

ALTER TABLE viajes
  ADD COLUMN origen_lat numeric(10, 7),
  ADD COLUMN origen_lng numeric(10, 7);

CREATE INDEX idx_viajes_origen_geocode
  ON viajes (origen_lat, origen_lng)
  WHERE origen_lat IS NOT NULL AND origen_lng IS NOT NULL;

COMMENT ON COLUMN viajes.origen_lat IS
  'Latitud WGS84 del punto de origen (≈ sucursal o dirección). Null si no geocodificado. Usado por D11 stakeholder geo aggregations (ADR-041).';
COMMENT ON COLUMN viajes.origen_lng IS
  'Longitud WGS84 del punto de origen. Null si no geocodificado.';
