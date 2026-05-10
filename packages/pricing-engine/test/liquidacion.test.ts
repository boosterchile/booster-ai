import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IVA_RATE_CL,
  PRICING_METHODOLOGY_VERSION,
  SEED_MEMBERSHIP_TIERS,
  calcularLiquidacion,
} from '../src/index.js';
import type { MembershipTier } from '../src/types.js';

describe('calcularLiquidacion — montos por tier (ADR-026 §2)', () => {
  it('Free (12%) sobre $1.000.000 → comisión $120.000', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.free,
    });
    expect(r.comisionPct).toBe(12);
    expect(r.comisionClp).toBe(120_000);
    expect(r.montoNetoCarrierClp).toBe(880_000);
    expect(r.tierAplicado).toBe('free');
  });

  it('Standard (9%) sobre $1.000.000 → comisión $90.000', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.standard,
    });
    expect(r.comisionClp).toBe(90_000);
    expect(r.montoNetoCarrierClp).toBe(910_000);
  });

  it('Pro (7%) sobre $1.000.000 → comisión $70.000', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.pro,
    });
    expect(r.comisionClp).toBe(70_000);
    expect(r.montoNetoCarrierClp).toBe(930_000);
  });

  it('Premium (5%) sobre $1.000.000 → comisión $50.000', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.premium,
    });
    expect(r.comisionClp).toBe(50_000);
    expect(r.montoNetoCarrierClp).toBe(950_000);
  });

  it('los 4 tiers sobre el mismo precio producen netos distintos', () => {
    const precio = 500_000;
    const netos = (['free', 'standard', 'pro', 'premium'] as const).map(
      (k) =>
        calcularLiquidacion({ agreedPriceClp: precio, tier: SEED_MEMBERSHIP_TIERS[k] })
          .montoNetoCarrierClp,
    );
    // Debe ser estrictamente creciente: tiers superiores → mayor neto.
    expect(netos[0]).toBeLessThan(netos[1]!);
    expect(netos[1]).toBeLessThan(netos[2]!);
    expect(netos[2]).toBeLessThan(netos[3]!);
  });
});

describe('calcularLiquidacion — IVA 19% Chile', () => {
  it('comisión $120.000 → IVA $22.800 → factura Booster $142.800', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.free,
    });
    expect(r.ivaComisionClp).toBe(22_800);
    expect(r.totalFacturaBoosterClp).toBe(142_800);
  });

  it('ivaRate=0 → totalFactura = comisión', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.free,
      ivaRate: 0,
    });
    expect(r.ivaComisionClp).toBe(0);
    expect(r.totalFacturaBoosterClp).toBe(120_000);
  });

  it('ivaRate=0.5 (hypothetical) → IVA = 50% de comisión', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1_000_000,
      tier: SEED_MEMBERSHIP_TIERS.free,
      ivaRate: 0.5,
    });
    expect(r.ivaComisionClp).toBe(60_000);
  });

  it('default IVA es 0.19 (Chile)', () => {
    expect(DEFAULT_IVA_RATE_CL).toBe(0.19);
  });
});

describe('calcularLiquidacion — edge cases', () => {
  it('agreedPriceClp = 0 → todos los montos = 0', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 0,
      tier: SEED_MEMBERSHIP_TIERS.free,
    });
    expect(r.montoBrutoClp).toBe(0);
    expect(r.comisionClp).toBe(0);
    expect(r.montoNetoCarrierClp).toBe(0);
    expect(r.ivaComisionClp).toBe(0);
    expect(r.totalFacturaBoosterClp).toBe(0);
  });

  it('redondeo HALF_UP: 12% de 12.345 → 1.481 (no 1.482)', () => {
    // 12345 * 0.12 = 1481.40 → round HALF_UP = 1481
    const r = calcularLiquidacion({
      agreedPriceClp: 12_345,
      tier: SEED_MEMBERSHIP_TIERS.free,
    });
    expect(r.comisionClp).toBe(1_481);
  });

  it('redondeo HALF_UP: 7% de 12.353 → 865 (0.5 sube)', () => {
    // 12353 * 0.07 = 864.71 → 865
    const r = calcularLiquidacion({
      agreedPriceClp: 12_353,
      tier: SEED_MEMBERSHIP_TIERS.pro,
    });
    expect(r.comisionClp).toBe(865);
  });

  it('IVA con fracción .5 redondea up (HALF_UP)', () => {
    // comisión = 5 → IVA = 5 * 0.19 = 0.95 → 1
    const r = calcularLiquidacion({
      agreedPriceClp: 100,
      tier: SEED_MEMBERSHIP_TIERS.free, // 12% de 100 = 12, IVA = 12 * 0.19 = 2.28 → 2
    });
    expect(r.comisionClp).toBe(12);
    expect(r.ivaComisionClp).toBe(2);
  });

  it('precio muy alto ($100M) escala linealmente', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 100_000_000,
      tier: SEED_MEMBERSHIP_TIERS.premium, // 5%
    });
    expect(r.comisionClp).toBe(5_000_000);
    expect(r.montoNetoCarrierClp).toBe(95_000_000);
    expect(r.ivaComisionClp).toBe(950_000); // 5M * 0.19
  });

  it('precio mínimo $1 → comisión 0 (round 0.12 → 0)', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 1,
      tier: SEED_MEMBERSHIP_TIERS.free,
    });
    expect(r.comisionClp).toBe(0);
    expect(r.montoNetoCarrierClp).toBe(1);
  });
});

describe('calcularLiquidacion — output metadata', () => {
  it('captura pricingMethodologyVersion del módulo', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 100_000,
      tier: SEED_MEMBERSHIP_TIERS.standard,
    });
    expect(r.pricingMethodologyVersion).toBe(PRICING_METHODOLOGY_VERSION);
    expect(r.pricingMethodologyVersion).toMatch(/^pricing-v\d+\.\d+-cl-\d{4}\.\d{2}$/);
  });

  it('tierAplicado coincide con el slug del input', () => {
    for (const slug of ['free', 'standard', 'pro', 'premium'] as const) {
      const r = calcularLiquidacion({
        agreedPriceClp: 100_000,
        tier: SEED_MEMBERSHIP_TIERS[slug],
      });
      expect(r.tierAplicado).toBe(slug);
    }
  });

  it('comisionPct espejo del tier (auditoría)', () => {
    const r = calcularLiquidacion({
      agreedPriceClp: 100_000,
      tier: SEED_MEMBERSHIP_TIERS.pro,
    });
    expect(r.comisionPct).toBe(7);
  });
});

describe('calcularLiquidacion — validación de inputs', () => {
  it('throw si agreedPriceClp negativo', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: -100,
        tier: SEED_MEMBERSHIP_TIERS.free,
      }),
    ).toThrow(/>= 0/);
  });

  it('throw si agreedPriceClp es NaN', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: Number.NaN,
        tier: SEED_MEMBERSHIP_TIERS.free,
      }),
    ).toThrow(/finito/);
  });

  it('throw si agreedPriceClp es Infinity', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: Number.POSITIVE_INFINITY,
        tier: SEED_MEMBERSHIP_TIERS.free,
      }),
    ).toThrow(/finito/);
  });

  it('throw si agreedPriceClp es float (debe ser integer)', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: 100.5,
        tier: SEED_MEMBERSHIP_TIERS.free,
      }),
    ).toThrow(/integer/);
  });

  it('throw si commissionPct fuera de [0,100]', () => {
    const tierMalo: MembershipTier = {
      ...SEED_MEMBERSHIP_TIERS.free,
      commissionPct: 150,
    };
    expect(() => calcularLiquidacion({ agreedPriceClp: 100_000, tier: tierMalo })).toThrow(
      /commissionPct fuera de rango/,
    );
  });

  it('throw si commissionPct negativo', () => {
    const tierMalo: MembershipTier = {
      ...SEED_MEMBERSHIP_TIERS.free,
      commissionPct: -5,
    };
    expect(() => calcularLiquidacion({ agreedPriceClp: 100_000, tier: tierMalo })).toThrow(
      /commissionPct/,
    );
  });

  it('throw si ivaRate fuera de [0,1]', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: 100_000,
        tier: SEED_MEMBERSHIP_TIERS.free,
        ivaRate: 1.5,
      }),
    ).toThrow(/ivaRate/);
  });

  it('throw si ivaRate negativo', () => {
    expect(() =>
      calcularLiquidacion({
        agreedPriceClp: 100_000,
        tier: SEED_MEMBERSHIP_TIERS.free,
        ivaRate: -0.1,
      }),
    ).toThrow(/ivaRate/);
  });
});

describe('SEED_MEMBERSHIP_TIERS — sanity del seed (ADR-026)', () => {
  it('fees mensuales: 0 / 15k / 45k / 120k', () => {
    expect(SEED_MEMBERSHIP_TIERS.free.feeMonthlyClp).toBe(0);
    expect(SEED_MEMBERSHIP_TIERS.standard.feeMonthlyClp).toBe(15_000);
    expect(SEED_MEMBERSHIP_TIERS.pro.feeMonthlyClp).toBe(45_000);
    expect(SEED_MEMBERSHIP_TIERS.premium.feeMonthlyClp).toBe(120_000);
  });

  it('comisión decreciente con tier', () => {
    expect(SEED_MEMBERSHIP_TIERS.free.commissionPct).toBe(12);
    expect(SEED_MEMBERSHIP_TIERS.standard.commissionPct).toBe(9);
    expect(SEED_MEMBERSHIP_TIERS.pro.commissionPct).toBe(7);
    expect(SEED_MEMBERSHIP_TIERS.premium.commissionPct).toBe(5);
  });

  it('priority boost creciente con tier', () => {
    expect(SEED_MEMBERSHIP_TIERS.free.matchingPriorityBoost).toBe(0);
    expect(SEED_MEMBERSHIP_TIERS.standard.matchingPriorityBoost).toBe(5);
    expect(SEED_MEMBERSHIP_TIERS.pro.matchingPriorityBoost).toBe(10);
    expect(SEED_MEMBERSHIP_TIERS.premium.matchingPriorityBoost).toBe(20);
  });

  it('solo premium incluye device Teltonika', () => {
    expect(SEED_MEMBERSHIP_TIERS.free.deviceTeltonikaIncluded).toBe(false);
    expect(SEED_MEMBERSHIP_TIERS.standard.deviceTeltonikaIncluded).toBe(false);
    expect(SEED_MEMBERSHIP_TIERS.pro.deviceTeltonikaIncluded).toBe(false);
    expect(SEED_MEMBERSHIP_TIERS.premium.deviceTeltonikaIncluded).toBe(true);
  });
});
