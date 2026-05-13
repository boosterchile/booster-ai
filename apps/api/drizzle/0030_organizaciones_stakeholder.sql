-- Migration 0030_organizaciones_stakeholder.sql
-- ADR-034 — Stakeholder organizations como entidad separada de `empresas`.
--
-- Crea la tabla `organizaciones_stakeholder` paralela a `empresas` para
-- representar reguladores, gremios, observatorios académicos, ONGs y
-- departamentos ESG corporativos. Cada stakeholder tiene scope opcional
-- (region_ambito, sector_ambito) que el backend usa para filtrar los
-- datos agregados que ve.
--
-- Alta solo por platform-admin; soft-delete via `eliminado_en`.
-- Auditoría: eventos org_stakeholder.* en tabla `eventos`.

CREATE TYPE tipo_organizacion_stakeholder AS ENUM (
  'regulador',
  'gremio',
  'observatorio_academico',
  'ong',
  'corporativo_esg'
);

CREATE TABLE organizaciones_stakeholder (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_legal          varchar(200) NOT NULL,
  tipo                  tipo_organizacion_stakeholder NOT NULL,
  region_ambito         varchar(50),
  sector_ambito         varchar(100),
  creado_por_admin_id   uuid REFERENCES usuarios(id),
  creado_en             timestamp with time zone NOT NULL DEFAULT now(),
  actualizado_en        timestamp with time zone NOT NULL DEFAULT now(),
  eliminado_en          timestamp with time zone,
  CONSTRAINT organizaciones_stakeholder_nombre_legal_check CHECK (length(nombre_legal) >= 3)
);

CREATE INDEX idx_organizaciones_stakeholder_tipo
  ON organizaciones_stakeholder (tipo);

CREATE INDEX idx_organizaciones_stakeholder_region
  ON organizaciones_stakeholder (region_ambito);

COMMENT ON TABLE organizaciones_stakeholder IS
  'ADR-034 — Entidad de pertenencia para usuarios con rol stakeholder_sostenibilidad. Paralela a empresas (no hija). Alta solo por platform-admin.';
COMMENT ON COLUMN organizaciones_stakeholder.region_ambito IS
  'Código ISO 3166-2:CL (e.g. CL-RM) o NULL = nacional. Filtro geográfico de datos agregados.';
COMMENT ON COLUMN organizaciones_stakeholder.sector_ambito IS
  'Slug libre (transporte-carga, manufactura...) o NULL = todos. Filtro sectorial.';
