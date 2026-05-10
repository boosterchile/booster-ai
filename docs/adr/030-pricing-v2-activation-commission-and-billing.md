# ADR-030 — Modelo de pricing v2: activación de comisión + billing recurrente

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: [ADR-027 Modelo de pricing v1](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md)
**Related**:
- [ADR-004 Modelo Uber-like y roles](./004-uber-like-model-and-roles.md)
- [ADR-007 Chile document management](./007-chile-document-management.md) — trigger `confirmed_by_shipper` → liquidación
- [ADR-021 GLEC v3 compliance](./021-glec-v3-compliance.md) — versionado de metodología (espejo aplicado a pricing)
- [ADR-023 Matching algorithm v1](./023-matching-algorithm-v1-greedy-capacity-scoring.md) — no influye sobre `proposedPriceClp`
- [ADR-024 SII provider Sovos](./024-sii-provider-sovos-with-multi-vendor-strategy.md) — emisión DTE
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) — tabla de tiers + fees + %
- [ADR-029 Factoring/pronto pago al transportista](./029-factoring-pronto-pago-al-transportista.md) — revenue stream adicional, fuera del scope de v2 core
- Memoria proyecto: [project_payment_factoring_strategy.md](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_payment_factoring_strategy.md)

---

## Contexto

ADR-027 v1 dejó cerrado el modelo "no monetizado" de Booster: trip uniform shipper-set, sin comisión, sin DTE, sin billing. Declaró cinco criterios de activación de v2 y prohibió cualquier columna de comisión hasta que este ADR exista.

A 2026-05-10 los criterios técnicos están al alcance (la base de tests es sólida, el matching funciona, los certificados se emiten), pero los criterios **de mercado** (≥30 carriers activos, ≥3 meses sin incidentes, T&Cs firmadas por ≥80%, sandbox Sovos validado) no están cumplidos. Este ADR adopta una postura intermedia:

1. **Decide arquitectónicamente** la activación de comisión + billing — el diseño es firme y revisable.
2. **Implementa la foundation técnica** (pricing-engine puro + tablas Drizzle + billing-engine stub + service de liquidación) detrás de un **feature flag** `PRICING_V2_ACTIVATED` por defecto `false`.
3. **Deja explícitamente diferidos** Sovos integration real, T&Cs públicas y migration apply-en-prod hasta que los criterios externos se cumplan.

Esta secuencia honra el principio del ADR-027 v1 ("prefer no cobrar nada bien a cobrar mal rápido") porque el código nuevo no opera contra producción mientras el flag está `false`, pero deja la arquitectura lista para activarse en horas, no semanas, cuando el mercado lo justifique.

---

## Decisión

### 1. Activación dual: hard switch + feature flag

La activación de cobro requiere **DOS** capas:

1. **Hard switch** (config env): `PRICING_V2_ACTIVATED=true` en Cloud Run. Sin este flag, el service `liquidar-trip` retorna `{ status: 'skipped', reason: 'pricing_v2_disabled' }` y NO escribe en BD.
2. **Carrier opt-in**: cada carrier debe tener `carrier_memberships.consent_terms_v2_accepted_at IS NOT NULL`. Sin consent firmado, la liquidación queda en estado `pending_consent` y NO emite DTE.

**Por qué dos capas**: el flag global protege contra activación accidental en deploy; el consent individual protege contra cobro a carriers que no aceptaron términos nuevos (requerimiento legal Chile per SII + protección consumidor).

### 2. Tabla `membership_tiers`: seed de los 4 tiers de ADR-026

```sql
CREATE TABLE membership_tiers (
  slug            text PRIMARY KEY,  -- 'free' | 'standard' | 'pro' | 'premium'
  display_name    text NOT NULL,
  fee_monthly_clp integer NOT NULL,  -- 0 / 15000 / 45000 / 120000
  commission_pct  numeric(4,2) NOT NULL,  -- 12.00 / 9.00 / 7.00 / 5.00
  matching_priority_boost integer NOT NULL DEFAULT 0,  -- 0 / 5 / 10 / 20
  trust_score_boost integer NOT NULL DEFAULT 0,  -- 0 / 0 / 5 / 10
  device_teltonika_included boolean NOT NULL DEFAULT false,  -- premium only
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

Seed inmutable (cambios via nuevo tier slug + migration, NUNCA UPDATE):

| slug | display_name | fee_monthly_clp | commission_pct | priority | trust | device |
|---|---|---|---|---|---|---|
| free | Booster Free | 0 | 12.00 | 0 | 0 | false |
| standard | Booster Standard | 15000 | 9.00 | 5 | 0 | false |
| pro | Booster Pro | 45000 | 7.00 | 10 | 5 | false |
| premium | Booster Premium | 120000 | 5.00 | 20 | 10 | true |

### 3. Tabla `carrier_memberships`

```sql
CREATE TABLE carrier_memberships (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                      uuid NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  tier_slug                       text NOT NULL REFERENCES membership_tiers(slug),
  status                          text NOT NULL CHECK (status IN ('activa','suspendida','cancelada')),
  consent_terms_v2_accepted_at    timestamptz,  -- null hasta que carrier acepte T&Cs v2
  consent_terms_v2_ip             text,
  consent_terms_v2_user_agent     text,
  activated_at                    timestamptz NOT NULL DEFAULT now(),
  suspended_at                    timestamptz,
  suspended_reason                text,
  cancelled_at                    timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_carrier_memberships_one_active_per_empresa
  ON carrier_memberships(empresa_id)
  WHERE status = 'activa';
```

Reglas:
- Solo UN membership `activa` por empresa (unique partial index).
- Si carrier upgrade/downgrade tier: nuevo row con status `activa` + UPDATE del anterior a `cancelada`.
- `consent_terms_v2_accepted_at` es prerequisito para que liquidaciones de esta empresa generen DTE real.

### 4. Tabla `liquidaciones` (una por assignment liquidable)

```sql
CREATE TABLE liquidaciones (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id                   uuid NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE RESTRICT,
  empresa_carrier_id              uuid NOT NULL REFERENCES empresas(id),
  tier_slug_aplicado              text NOT NULL REFERENCES membership_tiers(slug),
  monto_bruto_clp                 integer NOT NULL,    -- = assignment.precio_acordado_clp
  comision_pct                    numeric(4,2) NOT NULL,
  comision_clp                    integer NOT NULL,
  monto_neto_carrier_clp          integer NOT NULL,    -- = bruto - comision
  iva_comision_clp                integer NOT NULL,    -- = round(comision * 0.19)
  total_factura_booster_clp       integer NOT NULL,    -- = comision + iva
  pricing_methodology_version     text NOT NULL,       -- 'pricing-v2.0-cl-2026.06'
  status                          text NOT NULL CHECK (status IN (
                                    'pending_consent',
                                    'lista_para_dte',
                                    'dte_emitido',
                                    'pagada_al_carrier',
                                    'disputa'
                                  )),
  dte_factura_booster_folio       text,                -- folio Sovos
  dte_factura_booster_emitido_en  timestamptz,
  payout_carrier_metodo           text CHECK (payout_carrier_metodo IN ('transferencia_bancaria','pronto_pago_booster','factoring_externo')),
  payout_carrier_pagado_en        timestamptz,
  disputa_abierta_en              timestamptz,
  disputa_motivo                  text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_liquidaciones_empresa_status ON liquidaciones(empresa_carrier_id, status);
CREATE INDEX idx_liquidaciones_pricing_version ON liquidaciones(pricing_methodology_version);
```

Invariantes:
- 1:1 con `assignments` (UNIQUE constraint en `assignment_id`).
- `pricing_methodology_version` capturado al momento de liquidación, NUNCA se actualiza después (espejo de `glec_version` en `trip_metrics`).
- `status='disputa'` bloquea pagos y DTE hasta resolución manual (runbook `docs/runbooks/liquidacion-disputa.md`).

### 5. Tabla `facturas_booster_clp` (recurrentes: membership fees + comisiones)

```sql
CREATE TABLE facturas_booster_clp (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_destino_id              uuid NOT NULL REFERENCES empresas(id),
  tipo                            text NOT NULL CHECK (tipo IN ('comision_trip', 'membership_mensual')),
  liquidacion_id                  uuid REFERENCES liquidaciones(id),  -- null si tipo='membership_mensual'
  periodo_mes                     text,                                -- 'YYYY-MM', null si tipo='comision_trip'
  subtotal_clp                    integer NOT NULL,
  iva_clp                         integer NOT NULL,
  total_clp                       integer NOT NULL,
  dte_tipo                        integer NOT NULL DEFAULT 33,         -- 33 = Factura Electrónica
  dte_folio                       text,                                -- folio Sovos cuando emitida
  dte_emitida_en                  timestamptz,
  dte_pdf_gcs_uri                 text,
  status                          text NOT NULL CHECK (status IN ('pendiente','emitida','pagada','vencida','anulada')),
  vence_en                        timestamptz NOT NULL,
  pagada_en                       timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_facturas_membership_unique_por_mes
  ON facturas_booster_clp(empresa_destino_id, periodo_mes)
  WHERE tipo = 'membership_mensual';
```

El partial unique index garantiza que no se emita más de una factura de membresía por empresa y mes (idempotencia para el cron).

### 6. `packages/pricing-engine/`

Contrato del package:

```typescript
// src/types.ts
export const TIER_SLUGS = ['free', 'standard', 'pro', 'premium'] as const;
export type TierSlug = (typeof TIER_SLUGS)[number];

export interface MembershipTier {
  slug: TierSlug;
  displayName: string;
  feeMonthlyClp: number;
  commissionPct: number;
  matchingPriorityBoost: number;
  trustScoreBoost: number;
  deviceTeltonikaIncluded: boolean;
}

export interface LiquidacionInput {
  agreedPriceClp: number;        // = assignment.precio_acordado_clp
  tier: MembershipTier;
  ivaRate?: number;              // default 0.19
}

export interface LiquidacionOutput {
  montoBrutoClp: number;
  comisionPct: number;
  comisionClp: number;
  montoNetoCarrierClp: number;
  ivaComisionClp: number;
  totalFacturaBoosterClp: number;
  tierAplicado: TierSlug;
  pricingMethodologyVersion: string;
}

// src/liquidacion.ts
export const PRICING_METHODOLOGY_VERSION = 'pricing-v2.0-cl-2026.06' as const;
export function calcularLiquidacion(input: LiquidacionInput): LiquidacionOutput;
```

Reglas de rounding (Chile CLP no usa centavos):
- Todas las cantidades son `integer` CLP.
- `comisionClp = Math.round(montoBruto * commissionPct / 100)`.
- `ivaComisionClp = Math.round(comisionClp * 0.19)`.
- `montoNetoCarrierClp = montoBruto - comisionClp` (carrier recibe bruto menos comisión; IVA va aparte sobre la factura Booster→carrier).
- `totalFacturaBoosterClp = comisionClp + ivaComisionClp`.

Edge cases obligatorios en tests:
- `agreedPriceClp === 0` → todos los montos = 0
- `agreedPriceClp` que produce comisión con fracción ≥ 0.5 (round HALF_UP)
- Cada uno de los 4 tiers con un mismo precio (verifica que distinto `commissionPct` produce distinto neto)
- `ivaRate` custom (default 0.19, pero el contrato lo permite parametrizar para tests de cambios futuros)

### 7. `packages/billing-engine/` (cobro recurrente de membership)

Contrato:

```typescript
// src/types.ts
export interface CobroMembershipInput {
  empresaId: string;
  tier: MembershipTier;
  periodoMes: string;                // 'YYYY-MM'
  hoyMs: number;                     // injectable para tests
}

export interface CobroMembershipOutput {
  status: 'creada' | 'ya_emitida' | 'tier_gratis_skip';
  factura: {
    subtotalClp: number;             // = tier.feeMonthlyClp
    ivaClp: number;
    totalClp: number;
    venceEn: Date;                   // hoy + 14 días
  } | null;
}

// src/cobro-membership.ts
export function calcularCobroMembership(input: CobroMembershipInput): CobroMembershipOutput;
```

- `tier.feeMonthlyClp === 0` (Free) → `tier_gratis_skip`, no factura.
- Caller decide qué hacer con `status='ya_emitida'` (idempotencia se mantiene a nivel BD por el partial unique index del §5).
- `venceEn` = `hoy + 14 días`. Dunning de 3 reintentos cada 7 días (lógica en `apps/api/src/jobs/cobrar-memberships-mensual.ts`, cron mensual).

### 8. `apps/api/src/services/liquidar-trip.ts`

Service orquestador (toca DB, no es pura):

```typescript
liquidarTrip({
  db,
  logger,
  assignmentId,
  pricingV2Activated,    // = config.PRICING_V2_ACTIVATED
}): Promise<{
  status:
    | 'skipped_flag_disabled'
    | 'skipped_no_membership'
    | 'pending_consent'
    | 'liquidacion_creada'
    | 'ya_liquidada';
  liquidacionId?: string;
}>;
```

Flujo:
1. Si `!pricingV2Activated` → return `skipped_flag_disabled`.
2. Lookup `assignment` + `carrier_memberships.activa` por empresa carrier.
3. Si no hay membership activa → return `skipped_no_membership` (carrier nunca aceptó T&Cs v2).
4. Si `consent_terms_v2_accepted_at IS NULL` → INSERT liquidación con `status='pending_consent'` y return `pending_consent`. Esto deja la liquidación lista para emitir cuando el carrier acepte.
5. Calcular `calcularLiquidacion()` puro.
6. INSERT en `liquidaciones` con `status='lista_para_dte'`.
7. Return `liquidacion_creada` con id.
8. Si ya existe row para `assignment_id` (UNIQUE constraint), capturar y return `ya_liquidada`.

El paso de emisión real de DTE (status `lista_para_dte` → `dte_emitido`) lo hace un job separado `apps/api/src/jobs/emitir-dte-pendientes.ts` que llama Sovos. Esto desacopla el cálculo (rápido, sin red) del envío SII (lento, propenso a fallos transientes).

### 9. Versionado de la metodología

`pricing_methodology_version` sigue semver:
- `pricing-v2.0-cl-2026.06`: este ADR.
- Cualquier cambio futuro a `commission_pct`, `ivaRate`, redondeo, o nuevos tipos de costos (ej. service fee adicional al shipper) bumpea `MINOR`.
- Cambio de modelo (uniform → auction, pasar a multi-currency) bumpea `MAJOR` y requiere nuevo ADR.

Liquidaciones emitidas quedan con su versión original. Re-emisión retroactiva está prohibida (cualquier ajuste se hace via nueva factura de ajuste, no UPDATE).

### 10. Compatibilidad con factoring (ADR-029)

Cuando `payout_carrier_metodo='pronto_pago_booster'`:
- `payout_carrier_pagado_en` se setea al momento del adelanto al carrier (T+0 a T+3).
- `liquidaciones` no cambia su `total_factura_booster_clp` (la comisión sigue igual).
- El descuento por factoring se contabiliza en una tabla aparte `adelantos_pronto_pago` (definida en ADR-029).

Esto garantiza que el modelo de comisión es **independiente** del modelo de cash management.

---

## Consecuencias

### Positivas

- **Cero deuda fiscal** mantenida: nada se cobra hasta que el flag + consent + Sovos estén verdes.
- **Reversibilidad**: bajar `PRICING_V2_ACTIVATED=false` en Cloud Run revierte la activación en segundos sin tocar BD (las liquidaciones ya emitidas quedan; solo paran las nuevas).
- **Auditabilidad end-to-end**: `pricing_methodology_version` + `tier_slug_aplicado` en cada liquidación permite recomputar y comparar.
- **Modelo de billing claro**: facturas mensuales (membership) y trip-by-trip (comisión) coexisten en la misma tabla con `tipo` discriminador.
- **Foundation lista**: cuando se cumplan criterios de mercado, la activación es config + seed, no nueva arquitectura.
- **Sin dispersión**: pricing-engine es la única fuente de verdad de comisión. Cualquier PR que calcule comisión fuera del package debe ser rechazado.

### Negativas / costos

- **Código sin uso productivo inmediato**: pricing-engine + billing-engine + service de liquidación añaden líneas que no operan en prod hasta que el flag se prenda. Mitigación: 100% test coverage en pricing-engine + service tests con flag=true cubren el comportamiento.
- **Tabla `liquidaciones` puede crecer rápido**: con 100 trips/día × 365 días = 36.500 rows/año. Hoy negligible. Cuando supere 1M rows considerar particionamiento por `created_at`.
- **Dependencia futura crítica de Sovos**: cualquier outage Sovos bloquea DTE → afecta cobro real. Mitigación per ADR-024: provider abstracto con fallback Toku/Bsale.
- **Carriers tier Free no contribuyen revenue recurrente**: confiamos en up-sell al Standard. Si la conversión Free→Standard es <10% mensual, el modelo necesita revisión.

### Acciones derivadas (orden estricto)

1. **Implementar `packages/pricing-engine/`** con `calcularLiquidacion()` + 30+ tests. Coverage 100% obligatorio.
2. **Stub `packages/billing-engine/`** con `calcularCobroMembership()` + tests básicos.
3. **Migration 0019_pricing_v2.sql** (4 tablas) + seed inmutable de `membership_tiers`.
4. **Drizzle schema en `apps/api/src/db/schema.ts`** espejando las 4 tablas.
5. **Service `apps/api/src/services/liquidar-trip.ts`** con tests (mock DB) cubriendo cada branch del §8.
6. **Config en `apps/api/src/config.ts`**: `PRICING_V2_ACTIVATED: z.coerce.boolean().default(false)`.
7. **Wire del trigger**: handler de `confirmed_by_shipper` llama `liquidarTrip(...)`. Deja TODO bloqueante: NO mergear hasta criterios externos del §"Activación en producción".
8. **(Externo / no este PR)** Sovos sandbox integration en `apps/document-service/`. Esto bloquea el job `emitir-dte-pendientes` mencionado en §8.
9. **(Externo / no este PR)** T&Cs v2 públicas + flow UX en `apps/web` para que carrier acepte y se popule `consent_terms_v2_accepted_at`.
10. **Runbook `docs/runbooks/liquidacion-disputa.md`** + `runbooks/activar-pricing-v2.md` (checklist de producción).

### Criterios de activación en producción (DURO — sin esto NO se prende el flag)

- [ ] **Carriers**: ≥30 carriers con ≥1 trip aceptado mensual, sostenido 2 meses consecutivos.
- [ ] **Estabilidad operacional**: ≥3 meses sin incidentes críticos de matching, telemetría o certificados.
- [ ] **Legal**: T&Cs v2 publicadas + ≥80% de carriers activos las han aceptado (verificable vía `SELECT COUNT(*) FROM carrier_memberships WHERE consent_terms_v2_accepted_at IS NOT NULL`).
- [ ] **Sovos**: 100% de trips piloto en sandbox generan DTE válido sin rechazo SII durante 30 días.
- [ ] **Operacional**: migration `0019` aplicada en staging con dataset replicado de prod, ensayo de cobro mensual + emisión DTE end-to-end exitoso.
- [ ] **Comercial**: comunicación con carriers activos 30 días antes del primer cobro real (email + WhatsApp template).

Cumplidos los 6: el flag se prende en un PR explícito que cita este ADR, sin cambios de código.

### Métricas a instrumentar (al implementar)

- `pricing.liquidaciones_creadas_dia` (counter, labeled por `status`)
- `pricing.monto_liquidado_clp_total_mes` (sum)
- `pricing.comision_promedio_pct_mes` (gauge)
- `pricing.dte_emision_failure_rate` (% liquidaciones que no logran DTE en <60s)
- `pricing.membership_fees_facturadas_mes` (counter)
- `pricing.carrier_churn_post_cobro` (carriers que dejan de aceptar dentro de 30d post-primer-cobro)
- `pricing.pricing_v2_disabled_skips` (counter de liquidaciones skipped por flag)

---

## Validación (en este PR)

- [x] `packages/pricing-engine` implementado y testeado (función pura sin I/O).
- [x] `packages/billing-engine` implementado (cálculo puro de cobro mensual).
- [x] Migration `0019_pricing_v2.sql` creada con DDL completo + seed.
- [x] Drizzle schema en `apps/api/src/db/schema.ts` con las 4 tablas y relations.
- [x] `apps/api/src/services/liquidar-trip.ts` con tests cubriendo cada branch.
- [x] Feature flag `PRICING_V2_ACTIVATED` agregado a `config.ts` (default `false`).
- [ ] (Externo) Sovos sandbox integration — `apps/document-service` queda esqueleto.
- [ ] (Externo) T&Cs v2 públicas + UX consent — depende de legal.
- [ ] (Externo) Flag prendido en prod — depende de criterios de mercado del §"Activación en producción".

---

## Notas

- Este ADR es la **continuación natural** de ADR-027 v1. Cualquier inconsistencia entre ambos se resuelve a favor de ADR-030.
- El package `pricing-engine` está bajo `packages/` (no `apps/api`) porque la lógica de comisión es **conceptualmente compartible** con futuras superficies (CLI de ops, reporting batch, marketplace simulator).
- El IVA usado (19%) es Chile; si Booster opera en otros países en el futuro, `ivaRate` se vuelve parametrizable por jurisdicción del carrier (cambio MAJOR de pricing methodology version).
- El "single active membership per empresa" es una elección deliberada: simplifica reasoning + reporte; carriers con escenarios multi-tier (ej. tier distinto para subsidiaria) se modelan como empresas separadas.
- ADR-029 (pronto pago al transportista) es **opcional / revenue stream adicional**, NO requerido para activar v2. Diseñado para que `liquidaciones.payout_carrier_metodo` lo soporte sin cambios de schema.
