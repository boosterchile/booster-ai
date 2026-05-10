/**
 * Tipos puros del modelo de pricing v2 (ADR-030).
 *
 * Espejados 1:1 con la tabla `membership_tiers` del SQL para que la
 * conversión BD ↔ types sea trivial.
 */

export const TIER_SLUGS = ['free', 'standard', 'pro', 'premium'] as const;
export type TierSlug = (typeof TIER_SLUGS)[number];

export interface MembershipTier {
  slug: TierSlug;
  displayName: string;
  /** Fee mensual en CLP. 0 para tier Free. */
  feeMonthlyClp: number;
  /** Porcentaje de comisión sobre el monto bruto del viaje. 12.00 / 9.00 / 7.00 / 5.00. */
  commissionPct: number;
  /** Boost que se suma al score de matching para priorizar este carrier. */
  matchingPriorityBoost: number;
  /** Boost que se suma al trust score visible al shipper. */
  trustScoreBoost: number;
  /** Si el tier incluye device Teltonika subsidiado. */
  deviceTeltonikaIncluded: boolean;
}

/**
 * Seed inmutable de los 4 tiers del ADR-026. Esta constante es la
 * fuente de verdad en código cuando NO hay acceso a BD (ej. tests
 * puros, simulator). El service de liquidación lee de BD para tener
 * versionado vivo.
 */
export const SEED_MEMBERSHIP_TIERS: Readonly<Record<TierSlug, MembershipTier>> = {
  free: {
    slug: 'free',
    displayName: 'Booster Free',
    feeMonthlyClp: 0,
    commissionPct: 12.0,
    matchingPriorityBoost: 0,
    trustScoreBoost: 0,
    deviceTeltonikaIncluded: false,
  },
  standard: {
    slug: 'standard',
    displayName: 'Booster Standard',
    feeMonthlyClp: 15_000,
    commissionPct: 9.0,
    matchingPriorityBoost: 5,
    trustScoreBoost: 0,
    deviceTeltonikaIncluded: false,
  },
  pro: {
    slug: 'pro',
    displayName: 'Booster Pro',
    feeMonthlyClp: 45_000,
    commissionPct: 7.0,
    matchingPriorityBoost: 10,
    trustScoreBoost: 5,
    deviceTeltonikaIncluded: false,
  },
  premium: {
    slug: 'premium',
    displayName: 'Booster Premium',
    feeMonthlyClp: 120_000,
    commissionPct: 5.0,
    matchingPriorityBoost: 20,
    trustScoreBoost: 10,
    deviceTeltonikaIncluded: true,
  },
} as const;

export interface LiquidacionInput {
  /** Monto bruto del viaje en CLP integer. */
  agreedPriceClp: number;
  /** Tier vigente del carrier al momento de liquidar. */
  tier: MembershipTier;
  /** Tasa de IVA aplicada sobre la comisión. Default 0.19 (Chile). */
  ivaRate?: number;
}

export interface LiquidacionOutput {
  /** = input.agreedPriceClp (alias semántico). */
  montoBrutoClp: number;
  /** Espejo de tier.commissionPct (capturado en el output para auditoría). */
  comisionPct: number;
  /** = round(montoBrutoClp * comisionPct / 100). */
  comisionClp: number;
  /** = montoBrutoClp - comisionClp. Lo que recibe el carrier antes de IVA propio. */
  montoNetoCarrierClp: number;
  /** = round(comisionClp * ivaRate). */
  ivaComisionClp: number;
  /** = comisionClp + ivaComisionClp. Lo que Booster factura al carrier (DTE Tipo 33). */
  totalFacturaBoosterClp: number;
  /** Slug del tier aplicado (auditoría). */
  tierAplicado: TierSlug;
  /** Versión semver de la metodología de pricing. Capturada en BD. */
  pricingMethodologyVersion: string;
}

export interface CobroMembershipInput {
  empresaId: string;
  tier: MembershipTier;
  /** 'YYYY-MM' (ej. '2026-06'). El cron lo construye con la fecha en curso. */
  periodoMes: string;
  /** Tasa de IVA. Default 0.19. */
  ivaRate?: number;
  /** epoch ms del "hoy" para calcular `venceEn`. Inyectable para tests. */
  hoyMs: number;
  /** Días hasta vencimiento de la factura. Default 14. */
  diasVencimiento?: number;
}

export interface CobroMembershipFactura {
  subtotalClp: number;
  ivaClp: number;
  totalClp: number;
  /** Fecha de vencimiento (Date en UTC). */
  venceEn: Date;
}

export type CobroMembershipOutput =
  | { status: 'tier_gratis_skip'; factura: null }
  | { status: 'creada'; factura: CobroMembershipFactura };
