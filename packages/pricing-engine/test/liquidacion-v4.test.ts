import { describe, expect, it } from 'vitest';
import { PRICING_METHODOLOGY_VERSION_V4, calcularLiquidacionV4 } from '../src/index.js';

describe('calcularLiquidacionV4 (ADR-094 §1)', () => {
  it('ejemplo del PO: viaje de 100.000 con 5 %', () => {
    expect(calcularLiquidacionV4({ precioViajeClp: 100_000, comisionPct: 5 })).toEqual({
      precioViajeClp: 100_000,
      ivaViajeClp: 19_000,
      totalGeneradorClp: 119_000,
      comisionPct: 5,
      comisionClp: 5_000,
      ivaComisionClp: 950,
      totalFacturaBoosterClp: 5_950,
      precioTransportistaClp: 95_000,
      totalTransportistaClp: 113_050,
      pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V4,
    });
  });

  it('lo que paga el generador se reparte entero entre transportista y Booster', () => {
    for (const precioViajeClp of [1, 5, 999, 1_001, 333_333, 47_519_999]) {
      for (const comisionPct of [0, 3.5, 5, 12.5, 100]) {
        const r = calcularLiquidacionV4({ precioViajeClp, comisionPct });
        expect(r.totalTransportistaClp + r.totalFacturaBoosterClp).toBe(r.totalGeneradorClp);
        expect(r.precioTransportistaClp + r.comisionClp).toBe(r.precioViajeClp);
        expect(Number.isInteger(r.totalTransportistaClp)).toBe(true);
      }
    }
  });

  it('comisión 0 %: el transportista recibe todo lo que paga el generador', () => {
    const r = calcularLiquidacionV4({ precioViajeClp: 250_000, comisionPct: 0 });
    expect(r.totalFacturaBoosterClp).toBe(0);
    expect(r.precioTransportistaClp).toBe(250_000);
    expect(r.totalTransportistaClp).toBe(r.totalGeneradorClp);
  });

  it('precio 0 no falla y deja todo en 0', () => {
    const r = calcularLiquidacionV4({ precioViajeClp: 0, comisionPct: 5 });
    expect(r.totalGeneradorClp).toBe(0);
    expect(r.totalTransportistaClp).toBe(0);
  });

  it('redondea HALF_UP a peso entero', () => {
    // 1.010 × 2,5 % = 25,25 → 25; 1.030 × 2,5 % = 25,75 → 26.
    expect(calcularLiquidacionV4({ precioViajeClp: 1_010, comisionPct: 2.5 }).comisionClp).toBe(25);
    expect(calcularLiquidacionV4({ precioViajeClp: 1_030, comisionPct: 2.5 }).comisionClp).toBe(26);
  });

  it('usa la tasa de IVA que recibe', () => {
    const r = calcularLiquidacionV4({ precioViajeClp: 100_000, comisionPct: 10, ivaRate: 0.1 });
    expect(r.ivaViajeClp).toBe(10_000);
    expect(r.ivaComisionClp).toBe(1_000);
    expect(r.totalTransportistaClp).toBe(99_000);
  });

  it('rechaza entradas inválidas en vez de devolver un monto', () => {
    expect(() => calcularLiquidacionV4({ precioViajeClp: -1, comisionPct: 5 })).toThrow();
    expect(() => calcularLiquidacionV4({ precioViajeClp: 10.5, comisionPct: 5 })).toThrow();
    expect(() => calcularLiquidacionV4({ precioViajeClp: Number.NaN, comisionPct: 5 })).toThrow();
    expect(() => calcularLiquidacionV4({ precioViajeClp: 100, comisionPct: -1 })).toThrow();
    expect(() => calcularLiquidacionV4({ precioViajeClp: 100, comisionPct: 101 })).toThrow();
    expect(() =>
      calcularLiquidacionV4({ precioViajeClp: 100, comisionPct: 5, ivaRate: 1.5 }),
    ).toThrow();
  });
});
