-- Migration 0034 — Zonas stakeholder (D11 / ADR-041).
--
-- Tabla `zonas_stakeholder` con bounding box rectangular axis-aligned
-- (WGS84). Geografía curada para agregaciones del rol
-- `stakeholder_sostenibilidad`. Seed inicial con 5 zonas validadas contra
-- OSM. Idempotente via ON CONFLICT (slug). Para nueva zona, abrir PR con
-- migration siguiente — ver ADR-041 §Proceso "nueva zona".
--
-- Refs:
--   docs/adr/041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md
--   packages/shared-schemas/src/domain/zona-stakeholder.ts (espejo TS)
--   apps/api/src/db/schema.ts → zonasStakeholder (Drizzle table)

CREATE TYPE tipo_zona_stakeholder AS ENUM (
  'puerto',
  'mercado_abastos',
  'polo_industrial',
  'zona_franca'
);

CREATE TABLE zonas_stakeholder (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            varchar(60) NOT NULL UNIQUE,
  nombre          varchar(120) NOT NULL,
  region_code     varchar(8) NOT NULL,
  tipo            tipo_zona_stakeholder NOT NULL,
  lat_min         numeric(10, 7) NOT NULL,
  lat_max         numeric(10, 7) NOT NULL,
  lng_min         numeric(10, 7) NOT NULL,
  lng_max         numeric(10, 7) NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  creado_en       timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT zonas_stakeholder_bbox_lat_check CHECK (lat_min < lat_max),
  CONSTRAINT zonas_stakeholder_bbox_lng_check CHECK (lng_min < lng_max)
);

CREATE INDEX idx_zonas_stakeholder_active ON zonas_stakeholder (is_active);
CREATE INDEX idx_zonas_stakeholder_tipo   ON zonas_stakeholder (tipo);

COMMENT ON TABLE zonas_stakeholder IS
  'ADR-041 — Geografía curada para agregaciones stakeholder. Bbox WGS84 axis-aligned. k-anonymity ≥ 5 aplicado server-side.';

-- Seed inicial (D11) — 5 zonas. Bbox validados contra OpenStreetMap.
-- Cada link OSM en el comentario permite re-verificar a ojo.

-- Puerto Valparaíso (CL-VS). Comprende dársenas, antepuerto y zona de espera.
-- OSM: https://www.openstreetmap.org/?bbox=-71.645,-33.0501,-71.61,-33.0252
INSERT INTO zonas_stakeholder (slug, nombre, region_code, tipo, lat_min, lat_max, lng_min, lng_max) VALUES
  ('puerto-valparaiso', 'Puerto Valparaíso', 'CL-VS', 'puerto', -33.0501, -33.0252, -71.6450, -71.6100),

-- Puerto San Antonio (CL-VS). Terminal STI + Puerto Central + DP World.
-- OSM: https://www.openstreetmap.org/?bbox=-71.63,-33.6,-71.605,-33.58
  ('puerto-san-antonio', 'Puerto San Antonio', 'CL-VS', 'puerto', -33.6000, -33.5800, -71.6300, -71.6050),

-- Mercado Lo Valledor (CL-RM, Pedro Aguirre Cerda). Mayor mercado abastos CL.
-- OSM: https://www.openstreetmap.org/?bbox=-70.708,-33.516,-70.696,-33.507
  ('mercado-lo-valledor', 'Mercado Lo Valledor', 'CL-RM', 'mercado_abastos', -33.5160, -33.5070, -70.7080, -70.6960),

-- Polo Industrial Quilicura (CL-RM). ENEA + Lo Echevers + Av. Américo Vespucio.
-- OSM: https://www.openstreetmap.org/?bbox=-70.74,-33.37,-70.705,-33.345
  ('polo-industrial-quilicura', 'Polo Industrial Quilicura', 'CL-RM', 'polo_industrial', -33.3700, -33.3450, -70.7400, -70.7050),

-- Zona Franca Iquique - ZOFRI (CL-TA). Recinto amurallado norte de Iquique.
-- OSM: https://www.openstreetmap.org/?bbox=-70.12,-20.275,-70.093,-20.24
  ('zona-franca-iquique', 'Zona Franca Iquique', 'CL-TA', 'zona_franca', -20.2750, -20.2400, -70.1200, -70.0930)
ON CONFLICT (slug) DO NOTHING;
