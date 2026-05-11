-- Migration 0014 — Pricing v2 (ADR-030)
-- =============================================================================
-- Crea las 4 tablas core del modelo de pricing v2:
--   - membership_tiers           : catálogo de tiers (seed inmutable)
--   - carrier_memberships        : tier vigente por empresa + consent T&Cs v2
--   - liquidaciones              : 1 por assignment liquidable, captura
--                                  comision + IVA + neto + pricing_version
--   - facturas_booster_clp       : facturas que Booster emite (comisión por trip
--                                  + cuota mensual de membresía)
--
-- Diseño compatible con feature flag `PRICING_V2_ACTIVATED`. Las tablas
-- existen apenas se aplica la migration pero permanecen vacías hasta que
-- el service `liquidar-trip` empieza a escribir (flag=true).
--
-- Reversibilidad: bajar el flag no requiere rollback de SQL — las tablas
-- nunca tienen FK obligatorias DESDE el código de la app a estas tablas
-- (la dirección es trips → liquidaciones, no al revés).

-- =============================================================================
-- 1. membership_tiers
-- =============================================================================
CREATE TABLE membership_tiers (
  slug                        text PRIMARY KEY,
  display_name                text NOT NULL,
  fee_monthly_clp             integer NOT NULL CHECK (fee_monthly_clp >= 0),
  commission_pct              numeric(4,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 100),
  matching_priority_boost     integer NOT NULL DEFAULT 0,
  trust_score_boost           integer NOT NULL DEFAULT 0,
  device_teltonika_included   boolean NOT NULL DEFAULT false,
  creado_en                   timestamptz NOT NULL DEFAULT now(),
  actualizado_en              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE membership_tiers IS 'Catálogo inmutable de tiers de membresía del transportista (ADR-026 §2). Cambios a través de nuevas filas/migrations, NUNCA UPDATE en producción.';

-- Seed inmutable. Estas filas son la fuente de verdad en BD del seed
-- duplicado en packages/pricing-engine/src/types.ts. Si cambia uno,
-- cambia el otro y se bumpea pricing_methodology_version.
INSERT INTO membership_tiers (slug, display_name, fee_monthly_clp, commission_pct, matching_priority_boost, trust_score_boost, device_teltonika_included) VALUES
  ('free',     'Booster Free',      0,      12.00,  0,  0, false),
  ('standard', 'Booster Standard',  15000,  9.00,   5,  0, false),
  ('pro',      'Booster Pro',       45000,  7.00,  10,  5, false),
  ('premium',  'Booster Premium',   120000, 5.00,  20, 10, true);

-- =============================================================================
-- 2. carrier_memberships
-- =============================================================================
CREATE TABLE carrier_memberships (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                          uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tier_slug                           text NOT NULL REFERENCES membership_tiers(slug),
  status                              text NOT NULL CHECK (status IN ('activa','suspendida','cancelada')),
  consent_terms_v2_aceptado_en        timestamptz,
  consent_terms_v2_ip                 text,
  consent_terms_v2_user_agent         text,
  activada_en                         timestamptz NOT NULL DEFAULT now(),
  suspendida_en                       timestamptz,
  suspendida_motivo                   text,
  cancelada_en                        timestamptz,
  creado_en                           timestamptz NOT NULL DEFAULT now(),
  actualizado_en                      timestamptz NOT NULL DEFAULT now()
);

-- Solo UNA membership activa por empresa (upgrade/downgrade crea fila
-- nueva + cancela la anterior).
CREATE UNIQUE INDEX uq_carrier_memberships_una_activa_por_empresa
  ON carrier_memberships(empresa_id)
  WHERE status = 'activa';

CREATE INDEX idx_carrier_memberships_empresa_status
  ON carrier_memberships(empresa_id, status);

COMMENT ON COLUMN carrier_memberships.consent_terms_v2_aceptado_en IS
  'Prerequisito: si NULL, las liquidaciones de esta empresa quedan en estado pending_consent y NO emiten DTE.';

-- =============================================================================
-- 3. liquidaciones
-- =============================================================================
CREATE TABLE liquidaciones (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id                       uuid NOT NULL UNIQUE REFERENCES asignaciones(id) ON DELETE RESTRICT,
  empresa_carrier_id                  uuid NOT NULL REFERENCES empresas(id),
  tier_slug_aplicado                  text NOT NULL REFERENCES membership_tiers(slug),
  monto_bruto_clp                     integer NOT NULL CHECK (monto_bruto_clp >= 0),
  comision_pct                        numeric(4,2) NOT NULL,
  comision_clp                        integer NOT NULL CHECK (comision_clp >= 0),
  monto_neto_carrier_clp              integer NOT NULL CHECK (monto_neto_carrier_clp >= 0),
  iva_comision_clp                    integer NOT NULL CHECK (iva_comision_clp >= 0),
  total_factura_booster_clp           integer NOT NULL CHECK (total_factura_booster_clp >= 0),
  pricing_methodology_version         text NOT NULL,
  status                              text NOT NULL CHECK (status IN (
                                        'pending_consent',
                                        'lista_para_dte',
                                        'dte_emitido',
                                        'pagada_al_carrier',
                                        'disputa'
                                      )),
  dte_factura_booster_folio           text,
  dte_factura_booster_emitido_en      timestamptz,
  payout_carrier_metodo               text CHECK (payout_carrier_metodo IN (
                                        'transferencia_bancaria',
                                        'pronto_pago_booster',
                                        'factoring_externo'
                                      )),
  payout_carrier_pagado_en            timestamptz,
  disputa_abierta_en                  timestamptz,
  disputa_motivo                      text,
  creado_en                           timestamptz NOT NULL DEFAULT now(),
  actualizado_en                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_liquidaciones_empresa_status
  ON liquidaciones(empresa_carrier_id, status);
CREATE INDEX idx_liquidaciones_pricing_version
  ON liquidaciones(pricing_methodology_version);
CREATE INDEX idx_liquidaciones_status_creado
  ON liquidaciones(status, creado_en DESC);

COMMENT ON COLUMN liquidaciones.pricing_methodology_version IS
  'Capturada al crear, INMUTABLE. Permite recomputar la liquidación con la lógica de la época. Espejo de glec_version en metricas_viaje.';

-- =============================================================================
-- 4. facturas_booster_clp
-- =============================================================================
CREATE TABLE facturas_booster_clp (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_destino_id                  uuid NOT NULL REFERENCES empresas(id),
  tipo                                text NOT NULL CHECK (tipo IN ('comision_trip', 'membership_mensual')),
  liquidacion_id                      uuid REFERENCES liquidaciones(id),
  periodo_mes                         text,  -- 'YYYY-MM', solo para tipo=membership_mensual
  subtotal_clp                        integer NOT NULL CHECK (subtotal_clp >= 0),
  iva_clp                             integer NOT NULL CHECK (iva_clp >= 0),
  total_clp                           integer NOT NULL CHECK (total_clp >= 0),
  dte_tipo                            integer NOT NULL DEFAULT 33,
  dte_folio                           text,
  dte_emitida_en                      timestamptz,
  dte_pdf_gcs_uri                     text,
  status                              text NOT NULL CHECK (status IN (
                                        'pendiente','emitida','pagada','vencida','anulada'
                                      )),
  vence_en                            timestamptz NOT NULL,
  pagada_en                           timestamptz,
  creado_en                           timestamptz NOT NULL DEFAULT now(),
  actualizado_en                      timestamptz NOT NULL DEFAULT now(),

  -- Invariante: tipo='comision_trip' => liquidacion_id NOT NULL y periodo_mes NULL.
  -- Invariante: tipo='membership_mensual' => liquidacion_id NULL y periodo_mes NOT NULL.
  CONSTRAINT chk_factura_tipo_consistencia CHECK (
    (tipo = 'comision_trip' AND liquidacion_id IS NOT NULL AND periodo_mes IS NULL)
    OR
    (tipo = 'membership_mensual' AND liquidacion_id IS NULL AND periodo_mes IS NOT NULL)
  )
);

-- Idempotencia: no más de una factura de membresía por empresa+mes.
CREATE UNIQUE INDEX uq_facturas_membership_empresa_mes
  ON facturas_booster_clp(empresa_destino_id, periodo_mes)
  WHERE tipo = 'membership_mensual';

CREATE INDEX idx_facturas_empresa_status
  ON facturas_booster_clp(empresa_destino_id, status);
CREATE INDEX idx_facturas_status_vence
  ON facturas_booster_clp(status, vence_en);
