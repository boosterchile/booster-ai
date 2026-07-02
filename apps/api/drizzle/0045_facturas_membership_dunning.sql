-- Migration 0045 — dunning de cobro de membresías mensuales (ADR-030 §7 + ADR-031)
--
-- El cron `cobrar-memberships-mensual` (gap B5) factura la cuota mensual de los
-- carriers en tier pagado e invoca un `MembershipPaymentGateway` inyectado. El
-- rail de pago real está STUBEADO (no existe `payment-provider`): el stub no-op
-- NO cobra y deja la factura en `pending_payment_provider`. El dunning reintenta
-- hasta 3 veces con backoff de 7 días; al agotarlos la factura queda `morosa`.
--
-- Estas columnas modelan ese sub-estado de COBRANZA, separado del `status`
-- CONTABLE de la factura (`facturas_booster_clp.status`), que NO se toca. Así
-- evitamos un DROP/ADD CONSTRAINT sobre el CHECK de `status` (sería DDL
-- destructivo bajo ADR-066) — el dunning vive en su propia columna `cobro_estado`
-- con su propio CHECK.
--
-- Expand-only (ADR-066 / audit P1-H): solo ADD COLUMN (nullable o con DEFAULT) y
-- CREATE INDEX. Sin DROP, sin RENAME, sin SET NOT NULL retroactivo sobre filas
-- existentes — las facturas legacy (si las hubiera) quedan con `cobro_estado`
-- DEFAULT 'pendiente_cobro' e `intentos`=0, consistente. El rollback de la
-- revisión Cloud Run es seguro: una versión previa ignora estas columnas.
--
-- Reversibilidad: las columnas no tienen FK ni constraints obligatorios DESDE
-- otra tabla; el reverse manual (down/0045) simplemente las dropea. Ver
-- docs/runbooks/db-migration-rollback.md.

ALTER TABLE facturas_booster_clp
  ADD COLUMN cobro_estado text NOT NULL DEFAULT 'pendiente_cobro';
--> statement-breakpoint

ALTER TABLE facturas_booster_clp
  ADD COLUMN cobro_intentos integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE facturas_booster_clp
  ADD COLUMN cobro_ultimo_intento_en timestamptz;
--> statement-breakpoint

ALTER TABLE facturas_booster_clp
  ADD COLUMN cobro_proximo_intento_en timestamptz;
--> statement-breakpoint

-- Referencia opaca que devolvería el gateway de pago real (ids de transacción
-- del provider). NULL mientras el rail siga stubeado (el no-op no genera ref).
ALTER TABLE facturas_booster_clp
  ADD COLUMN cobro_gateway_ref text;
--> statement-breakpoint

-- CHECK de los valores válidos del sub-estado de cobranza (dunning).
ALTER TABLE facturas_booster_clp
  ADD CONSTRAINT chk_facturas_cobro_estado CHECK (
    cobro_estado IN (
      'pendiente_cobro',
      'pending_payment_provider',
      'reintentando',
      'morosa',
      'cobrada'
    )
  );
--> statement-breakpoint

-- Cola de reintentos: el cron busca facturas reintentables (estado en
-- pending_payment_provider/reintentando) cuyo cobro_proximo_intento_en venció.
-- Índice parcial para que ese SELECT sea eficiente sin escanear toda la tabla.
CREATE INDEX idx_facturas_cobro_reintento
  ON facturas_booster_clp(cobro_proximo_intento_en)
  WHERE cobro_estado IN ('pending_payment_provider', 'reintentando');
--> statement-breakpoint

COMMENT ON COLUMN facturas_booster_clp.cobro_estado IS
  'Sub-estado de COBRANZA (dunning), separado del status contable. Mientras el rail de pago esté stubeado, las facturas paran en pending_payment_provider (no cobradas). ADR-031.';
--> statement-breakpoint

COMMENT ON COLUMN facturas_booster_clp.cobro_gateway_ref IS
  'Ref del provider de pago real. NULL mientras MembershipPaymentGateway sea el stub no-op (no existe payment-provider).';
