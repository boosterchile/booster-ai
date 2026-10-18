import { describe, expect, it } from 'vitest';
import {
  PRICING_METHODOLOGY_VERSION_V3,
  calcularLiquidacionV3,
  resolverComisionPct,
} from '../src/index.js';

const comisiones = { spotPct: 20, programadaPct: 10, retornoProgramadaPct: 12 };

describe('resolverComisionPct (ADR-079 §2)', () => {
  it('spot paga la tasa spot, sea retorno o no', () => {
    expect(resolverComisionPct({ modalidad: 'spot', esRetorno: false, comisiones })).toBe(20);
    expect(resolverComisionPct({ modalidad: 'spot', esRetorno: true, comisiones })).toBe(20);
  });

  it('programada paga la tasa programada; un retorno programado paga la de retorno', () => {
    expect(resolverComisionPct({ modalidad: 'programada', esRetorno: false, comisiones })).toBe(10);
    expect(resolverComisionPct({ modalidad: 'programada', esRetorno: true, comisiones })).toBe(12);
  });

  it('retorno programado sin tasa de retorno configurada cae a la programada', () => {
    expect(
      resolverComisionPct({
        modalidad: 'programada',
        esRetorno: true,
        comisiones: { spotPct: 20, programadaPct: 10 },
      }),
    ).toBe(10);
  });
});

describe('calcularLiquidacionV3 (ADR-079 §1 y §6)', () => {
  it('ejemplo del viaje de $700.000 spot: el generador paga la comisión encima', () => {
    expect(calcularLiquidacionV3({ precioTransportistaClp: 700_000, comisionPct: 20 })).toEqual({
      precioTransportistaClp: 700_000,
      comisionPct: 20,
      comisionClp: 140_000,
      ivaComisionClp: 26_600,
      precioGeneradorClp: 840_000,
      totalFacturaGeneradorClp: 166_600,
      pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
    });
  });

  it('el transportista recibe su precio íntegro (sin descuento de Booster)', () => {
    const r = calcularLiquidacionV3({ precioTransportistaClp: 333_333, comisionPct: 10 });
    expect(r.precioTransportistaClp).toBe(333_333);
    expect(r.precioGeneradorClp).toBe(r.precioTransportistaClp + r.comisionClp);
    expect(r.totalFacturaGeneradorClp).toBe(r.comisionClp + r.ivaComisionClp);
  });

  it('precio 0 → todo 0', () => {
    const r = calcularLiquidacionV3({ precioTransportistaClp: 0, comisionPct: 20 });
    expect(r.comisionClp).toBe(0);
    expect(r.ivaComisionClp).toBe(0);
    expect(r.precioGeneradorClp).toBe(0);
    expect(r.totalFacturaGeneradorClp).toBe(0);
  });

  it('redondeo HALF_UP a CLP entero en comisión e IVA', () => {
    // 12,5 % de 1.001 = 125,125 → 125; IVA 19 % de 125 = 23,75 → 24
    const a = calcularLiquidacionV3({ precioTransportistaClp: 1_001, comisionPct: 12.5 });
    expect(a.comisionClp).toBe(125);
    expect(a.ivaComisionClp).toBe(24);
    // 10 % de 5 = 0,5 → 1 (HALF_UP)
    expect(calcularLiquidacionV3({ precioTransportistaClp: 5, comisionPct: 10 }).comisionClp).toBe(
      1,
    );
  });

  it('IVA parametrizable', () => {
    const r = calcularLiquidacionV3({
      precioTransportistaClp: 100_000,
      comisionPct: 10,
      ivaRate: 0,
    });
    expect(r.ivaComisionClp).toBe(0);
    expect(r.totalFacturaGeneradorClp).toBe(10_000);
    expect(
      calcularLiquidacionV3({ precioTransportistaClp: 100_000, comisionPct: 10, ivaRate: 0.1 })
        .ivaComisionClp,
    ).toBe(1_000);
  });

  it('rechaza entradas inválidas en vez de devolver montos silenciosos', () => {
    expect(() => calcularLiquidacionV3({ precioTransportistaClp: -1, comisionPct: 10 })).toThrow();
    expect(() =>
      calcularLiquidacionV3({ precioTransportistaClp: 10.5, comisionPct: 10 }),
    ).toThrow();
    expect(() =>
      calcularLiquidacionV3({ precioTransportistaClp: Number.NaN, comisionPct: 10 }),
    ).toThrow();
    expect(() => calcularLiquidacionV3({ precioTransportistaClp: 100, comisionPct: -1 })).toThrow();
    expect(() =>
      calcularLiquidacionV3({ precioTransportistaClp: 100, comisionPct: 101 }),
    ).toThrow();
    expect(() =>
      calcularLiquidacionV3({ precioTransportistaClp: 100, comisionPct: 10, ivaRate: 1.5 }),
    ).toThrow();
  });

  it('versión de metodología MAJOR v3', () => {
    expect(PRICING_METHODOLOGY_VERSION_V3).toBe('pricing-v3.0-cl-2026.09');
  });
});
