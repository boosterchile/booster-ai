-- Migration 0086 — Booster Fleet: mantenciones del vehículo.
-- Expand-only. No toca filas existentes.
-- Spec: .specs/booster-fleet/spec.md

CREATE TABLE IF NOT EXISTS mantenciones_vehiculo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas (id) ON DELETE RESTRICT,
  vehiculo_id uuid NOT NULL REFERENCES vehiculos (id) ON DELETE RESTRICT,
  tipo text NOT NULL,
  titulo varchar(160) NOT NULL,
  programada_para date NOT NULL,
  kilometraje_objetivo integer,
  realizada_en timestamptz,
  kilometraje_realizado integer,
  cancelada_en timestamptz,
  notas text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_mantenciones_tipo CHECK (tipo IN ('preventiva', 'correctiva', 'inspeccion')),
  CONSTRAINT ck_mantenciones_titulo CHECK (char_length(titulo) >= 3),
  CONSTRAINT ck_mantenciones_km_objetivo CHECK (kilometraje_objetivo IS NULL OR kilometraje_objetivo >= 0),
  CONSTRAINT ck_mantenciones_km_realizado CHECK (kilometraje_realizado IS NULL OR kilometraje_realizado >= 0),
  CONSTRAINT ck_mantenciones_cierre CHECK (realizada_en IS NULL OR cancelada_en IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_mantenciones_empresa_fecha
  ON mantenciones_vehiculo (empresa_id, programada_para);

CREATE INDEX IF NOT EXISTS idx_mantenciones_vehiculo
  ON mantenciones_vehiculo (vehiculo_id);
