import { describe, expect, it } from 'vitest';
import { SEED_MEMBERSHIP_TIERS, calcularCobroMembership, periodoMesDesde } from '../src/index.js';

const HOY_MS = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00Z

describe('calcularCobroMembership — tier Free skip', () => {
  it('tier Free → status="tier_gratis_skip" sin factura', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.free,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
    });
    expect(r.status).toBe('tier_gratis_skip');
    expect(r.factura).toBeNull();
  });
});

describe('calcularCobroMembership — tiers pagados', () => {
  it('Standard ($15.000) → subtotal 15k, IVA 2.850, total 17.850', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.standard,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
    });
    expect(r.status).toBe('creada');
    if (r.status !== 'creada') {
      return;
    }
    expect(r.factura.subtotalClp).toBe(15_000);
    expect(r.factura.ivaClp).toBe(2_850);
    expect(r.factura.totalClp).toBe(17_850);
  });

  it('Pro ($45.000) → subtotal 45k, IVA 8.550, total 53.550', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.pro,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
    });
    if (r.status !== 'creada') {
      throw new Error('expected creada');
    }
    expect(r.factura.subtotalClp).toBe(45_000);
    expect(r.factura.ivaClp).toBe(8_550);
    expect(r.factura.totalClp).toBe(53_550);
  });

  it('Premium ($120.000) → subtotal 120k, IVA 22.800, total 142.800', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.premium,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
    });
    if (r.status !== 'creada') {
      throw new Error('expected creada');
    }
    expect(r.factura.subtotalClp).toBe(120_000);
    expect(r.factura.ivaClp).toBe(22_800);
    expect(r.factura.totalClp).toBe(142_800);
  });
});

describe('calcularCobroMembership — vencimiento', () => {
  it('default 14 días desde hoyMs', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.standard,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
    });
    if (r.status !== 'creada') {
      throw new Error('expected creada');
    }
    const esperado = new Date(HOY_MS + 14 * 24 * 60 * 60 * 1000);
    expect(r.factura.venceEn.toISOString()).toBe(esperado.toISOString());
  });

  it('diasVencimiento custom (30) → hoyMs + 30 días', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.standard,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
      diasVencimiento: 30,
    });
    if (r.status !== 'creada') {
      throw new Error('expected creada');
    }
    const esperado = new Date(HOY_MS + 30 * 24 * 60 * 60 * 1000);
    expect(r.factura.venceEn.toISOString()).toBe(esperado.toISOString());
  });
});

describe('calcularCobroMembership — IVA parametrizable', () => {
  it('ivaRate=0 → IVA = 0, total = subtotal', () => {
    const r = calcularCobroMembership({
      empresaId: 'e1',
      tier: SEED_MEMBERSHIP_TIERS.pro,
      periodoMes: '2026-06',
      hoyMs: HOY_MS,
      ivaRate: 0,
    });
    if (r.status !== 'creada') {
      throw new Error('expected creada');
    }
    expect(r.factura.ivaClp).toBe(0);
    expect(r.factura.totalClp).toBe(45_000);
  });
});

describe('calcularCobroMembership — validación', () => {
  it('hoyMs inválido (NaN) → throw', () => {
    expect(() =>
      calcularCobroMembership({
        empresaId: 'e1',
        tier: SEED_MEMBERSHIP_TIERS.standard,
        periodoMes: '2026-06',
        hoyMs: Number.NaN,
      }),
    ).toThrow(/hoyMs/);
  });

  it('hoyMs negativo → throw', () => {
    expect(() =>
      calcularCobroMembership({
        empresaId: 'e1',
        tier: SEED_MEMBERSHIP_TIERS.standard,
        periodoMes: '2026-06',
        hoyMs: -1,
      }),
    ).toThrow(/hoyMs/);
  });

  it('diasVencimiento 0 → throw', () => {
    expect(() =>
      calcularCobroMembership({
        empresaId: 'e1',
        tier: SEED_MEMBERSHIP_TIERS.standard,
        periodoMes: '2026-06',
        hoyMs: HOY_MS,
        diasVencimiento: 0,
      }),
    ).toThrow(/diasVencimiento/);
  });

  it('tier con fee negativo (corrupción) → throw', () => {
    expect(() =>
      calcularCobroMembership({
        empresaId: 'e1',
        tier: { ...SEED_MEMBERSHIP_TIERS.standard, feeMonthlyClp: -1 },
        periodoMes: '2026-06',
        hoyMs: HOY_MS,
      }),
    ).toThrow(/feeMonthlyClp/);
  });
});

describe('periodoMesDesde — formato YYYY-MM zona Chile (UTC-3)', () => {
  it('15 jun UTC mediodía → 2026-06', () => {
    expect(periodoMesDesde(new Date('2026-06-15T12:00:00Z'))).toBe('2026-06');
  });

  it('1 ene a las 02:00 UTC = 31 dic 23:00 Chile → 2025-12', () => {
    expect(periodoMesDesde(new Date('2026-01-01T02:00:00Z'))).toBe('2025-12');
  });

  it('1 ene a las 03:00 UTC = 1 ene 00:00 Chile → 2026-01', () => {
    expect(periodoMesDesde(new Date('2026-01-01T03:00:00Z'))).toBe('2026-01');
  });

  it('cada mes 01-12 mapea a 01-12', () => {
    for (let m = 0; m < 12; m++) {
      const ts = Date.UTC(2026, m, 15, 12);
      const slug = periodoMesDesde(new Date(ts));
      const expected = String(m + 1).padStart(2, '0');
      expect(slug).toBe(`2026-${expected}`);
    }
  });
});
