-- Migration 0036 — zonas_stakeholder: agrega comuna_codes (ADR-042).
--
-- Per ADR-042 §1-§2: el filtro pivotó de bounding box geográfico a
-- `originComunaCode = ANY(z.comuna_codes)`. Esto requiere un nuevo
-- campo `text[] comuna_codes` en `zonas_stakeholder`.
--
-- Las columnas existentes `lat_min/max/lng_min/lng_max` se mantienen
-- como metadata informativo (ADR-042 §3) — no se dropean.
--
-- Codigos comuna ISO 3166-2:CL — referencia oficial:
-- https://en.wikipedia.org/wiki/ISO_3166-2:CL

ALTER TABLE zonas_stakeholder
  ADD COLUMN comuna_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX idx_zonas_stakeholder_comuna_codes
  ON zonas_stakeholder USING GIN (comuna_codes);

COMMENT ON COLUMN zonas_stakeholder.comuna_codes IS
  'Codigos comuna ISO 3166-2:CL (e.g. CL-RM-QUI). Un viaje pertenece a la zona si v.origen_codigo_comuna = ANY(z.comuna_codes). ADR-042. Default ARRAY[] permite back-compat — zonas sin comunas no agregan nada.';

-- Backfill de las 5 zonas seed (de migration 0034) con sus comuna codes.
-- Codigos ISO 3166-2:CL verificados contra Wikipedia.

UPDATE zonas_stakeholder
SET comuna_codes = ARRAY['CL-VS-VAL']  -- Valparaiso comuna (puerto, antepuerto)
WHERE slug = 'puerto-valparaiso';

UPDATE zonas_stakeholder
SET comuna_codes = ARRAY['CL-VS-SAN']  -- San Antonio comuna (terminales STI + Central + DP World)
WHERE slug = 'puerto-san-antonio';

UPDATE zonas_stakeholder
SET comuna_codes = ARRAY['CL-RM-PED']  -- Pedro Aguirre Cerda (Lo Valledor esta aqui)
WHERE slug = 'mercado-lo-valledor';

UPDATE zonas_stakeholder
SET comuna_codes = ARRAY['CL-RM-QUI']  -- Quilicura comuna (ENEA + Lo Echevers)
WHERE slug = 'polo-industrial-quilicura';

UPDATE zonas_stakeholder
SET comuna_codes = ARRAY['CL-TA-IQQ']  -- Iquique comuna (ZOFRI)
WHERE slug = 'zona-franca-iquique';
