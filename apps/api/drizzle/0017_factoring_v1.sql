-- Migration 0017 — Factoring v1 (ADR-029 + ADR-032)
-- =============================================================================
-- Tablas para el producto "Booster Cobra Hoy":
--   - shipper_credit_decisions : underwriting cacheado por shipper (30d default)
--   - adelantos_carrier        : 1 por asignación (UNIQUE), captura tarifa +
--                                monto adelantado + estado del flow
--
-- Diseño compatible con feature flag `FACTORING_V1_ACTIVATED`. Las tablas
-- existen apenas se aplica la migration pero permanecen vacías hasta que
-- el flag se prende.

-- =============================================================================
-- 1. shipper_credit_decisions
-- =============================================================================
CREATE TABLE shipper_credit_decisions (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_shipper_id              uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  approved                        boolean NOT NULL,
  limit_exposure_clp              integer NOT NULL DEFAULT 0 CHECK (limit_exposure_clp >= 0),
  current_exposure_clp            integer NOT NULL DEFAULT 0 CHECK (current_exposure_clp >= 0),
  equifax_score                   integer CHECK (equifax_score IS NULL OR (equifax_score >= 0 AND equifax_score <= 1000)),
  decided_at                      timestamptz NOT NULL DEFAULT now(),
  decided_by                      text NOT NULL CHECK (decided_by IN ('automatico','manual')),
  expires_at                      timestamptz NOT NULL,
  motivo                          text,
  creado_en                       timestamptz NOT NULL DEFAULT now(),
  actualizado_en                  timestamptz NOT NULL DEFAULT now()
);

-- Solo UNA decisión vigente por shipper (las expiradas quedan para auditoría).
--
-- NOTA: Postgres rechaza `WHERE expires_at > now()` porque `now()` no es
-- IMMUTABLE. Workaround: índice unique por (empresa_shipper_id, expires_at).
-- La app code filtra por `expires_at > now()` en queries de lectura. Si en
-- el futuro queremos enforce a nivel BD, usar una columna boolean
-- `vigente` actualizada por trigger o por la propia app.
CREATE UNIQUE INDEX uq_shipper_credit_decisions_vigente
  ON shipper_credit_decisions(empresa_shipper_id, expires_at);

CREATE INDEX idx_shipper_credit_decisions_expires
  ON shipper_credit_decisions(expires_at);

COMMENT ON TABLE shipper_credit_decisions IS
  'Underwriting de shippers para Cobra Hoy (ADR-029 §3 + ADR-032 §5). Cacheado 30d default.';

-- =============================================================================
-- 2. adelantos_carrier
-- =============================================================================
CREATE TABLE adelantos_carrier (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id                   uuid NOT NULL UNIQUE REFERENCES asignaciones(id) ON DELETE RESTRICT,
  liquidacion_id                  uuid REFERENCES liquidaciones(id),
  empresa_carrier_id              uuid NOT NULL REFERENCES empresas(id),
  empresa_shipper_id              uuid NOT NULL REFERENCES empresas(id),
  monto_neto_clp                  integer NOT NULL CHECK (monto_neto_clp >= 0),
  plazo_dias_shipper              integer NOT NULL CHECK (plazo_dias_shipper > 0),
  tarifa_pct                      numeric(4,2) NOT NULL CHECK (tarifa_pct >= 0 AND tarifa_pct <= 100),
  tarifa_clp                      integer NOT NULL CHECK (tarifa_clp >= 0),
  monto_adelantado_clp            integer NOT NULL CHECK (monto_adelantado_clp >= 0),
  partner_slug                    text,
  partner_request_id              text,
  status                          text NOT NULL CHECK (status IN (
                                    'solicitado',
                                    'aprobado',
                                    'desembolsado',
                                    'cobrado_a_shipper',
                                    'mora',
                                    'cancelado',
                                    'rechazado'
                                  )),
  rechazo_motivo                  text,
  desembolsado_en                 timestamptz,
  cobrado_a_shipper_en            timestamptz,
  mora_desde                      timestamptz,
  factoring_methodology_version   text NOT NULL,
  creado_en                       timestamptz NOT NULL DEFAULT now(),
  actualizado_en                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_adelantos_carrier_empresa_status
  ON adelantos_carrier(empresa_carrier_id, status);
CREATE INDEX idx_adelantos_carrier_shipper_status
  ON adelantos_carrier(empresa_shipper_id, status);
CREATE INDEX idx_adelantos_carrier_methodology
  ON adelantos_carrier(factoring_methodology_version);
CREATE INDEX idx_adelantos_carrier_status_creado
  ON adelantos_carrier(status, creado_en DESC);

COMMENT ON COLUMN adelantos_carrier.factoring_methodology_version IS
  'INMUTABLE post-INSERT. Permite recomputar la tarifa con la lógica de la época.';
