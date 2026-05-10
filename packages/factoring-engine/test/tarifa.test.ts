import { describe, expect, it } from 'vitest';
import { FACTORING_METHODOLOGY_VERSION, calcularTarifaProntoPago } from '../src/index.js';

describe('calcularTarifaProntoPago — tabla oficial (ADR-029 §2)', () => {
  it('30 días → 1.5%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 30 });
    expect(r.tarifaPct).toBe(1.5);
    expect(r.tarifaClp).toBe(15_000);
    expect(r.montoAdelantadoClp).toBe(985_000);
  });

  it('45 días → 2.2%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 45 });
    expect(r.tarifaPct).toBe(2.2);
    expect(r.tarifaClp).toBe(22_000);
    expect(r.montoAdelantadoClp).toBe(978_000);
  });

  it('60 días → 3.0%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 60 });
    expect(r.tarifaPct).toBe(3.0);
    expect(r.tarifaClp).toBe(30_000);
    expect(r.montoAdelantadoClp).toBe(970_000);
  });

  it('90 días → 4.5%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 90 });
    expect(r.tarifaPct).toBe(4.5);
    expect(r.tarifaClp).toBe(45_000);
    expect(r.montoAdelantadoClp).toBe(955_000);
  });
});

describe('calcularTarifaProntoPago — interpolación lineal entre tabla', () => {
  it('plazo 37 días (entre 30 y 45) → interpolación', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 37 });
    // 30→1.5, 45→2.2, diff=0.7 sobre 15 días.
    // 37 está a 7 días de 30, ratio 7/15. Tarifa = 1.5 + 7/15 * 0.7 = 1.83 (round 2 dec).
    expect(r.tarifaPct).toBe(1.83);
  });

  it('plazo 52 días (entre 45 y 60) → interpolación', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 52 });
    // 45→2.2, 60→3.0, diff=0.8 sobre 15 días. 52-45=7. 7/15 * 0.8 = 0.373...
    // tarifa = 2.2 + 0.373 = 2.573 → round 2 dec = 2.57
    expect(r.tarifaPct).toBeCloseTo(2.57, 2);
  });

  it('plazo 75 días (entre 60 y 90) → interpolación', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 1_000_000, plazoDiasShipper: 75 });
    // 60→3.0, 90→4.5, diff=1.5 sobre 30 días. 75-60=15. 15/30 * 1.5 = 0.75.
    // tarifa = 3.0 + 0.75 = 3.75
    expect(r.tarifaPct).toBe(3.75);
  });
});

describe('calcularTarifaProntoPago — fuera de tabla', () => {
  it('plazo < 30 días → tarifa piso 1.5%', () => {
    const r1 = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 15 });
    expect(r1.tarifaPct).toBe(1.5);

    const r2 = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 1 });
    expect(r2.tarifaPct).toBe(1.5);
  });

  it('plazo 105 días (15 días sobre 90) → 4.5 + 0.5 = 5.0%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 105 });
    expect(r.tarifaPct).toBe(5.0);
  });

  it('plazo 120 días → 4.5 + 1.0 = 5.5%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 120 });
    expect(r.tarifaPct).toBe(5.5);
  });

  it('plazo 365 días → tarifa techo 8%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 365 });
    expect(r.tarifaPct).toBe(8.0);
  });

  it('plazo 91 días (1 día sobre 90) → +0.5%', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 91 });
    // 1 día = 1 incremento de 15d (ceil) = 0.5pp extra
    expect(r.tarifaPct).toBe(5.0);
  });
});

describe('calcularTarifaProntoPago — edge cases', () => {
  it('montoNetoClp 0 → tarifa 0', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 0, plazoDiasShipper: 30 });
    expect(r.tarifaClp).toBe(0);
    expect(r.montoAdelantadoClp).toBe(0);
  });

  it('redondeo HALF_UP: 1.5% de 100.001 = 1500.015 → 1500', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_001, plazoDiasShipper: 30 });
    expect(r.tarifaClp).toBe(1_500);
  });

  it('redondeo HALF_UP: 3% de 100.333 = 3009.99 → 3010', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_333, plazoDiasShipper: 60 });
    expect(r.tarifaClp).toBe(3_010);
  });

  it('monto muy grande ($100M) → escala linealmente', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000_000, plazoDiasShipper: 60 });
    expect(r.tarifaClp).toBe(3_000_000);
    expect(r.montoAdelantadoClp).toBe(97_000_000);
  });

  it('captura factoringMethodologyVersion en el output', () => {
    const r = calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 30 });
    expect(r.factoringMethodologyVersion).toBe(FACTORING_METHODOLOGY_VERSION);
    expect(r.factoringMethodologyVersion).toMatch(/^factoring-v\d+\.\d+-cl-\d{4}\.\d{2}$/);
  });
});

describe('calcularTarifaProntoPago — validación inputs', () => {
  it('montoNetoClp negativo → throw', () => {
    expect(() => calcularTarifaProntoPago({ montoNetoClp: -100, plazoDiasShipper: 30 })).toThrow(
      />= 0/,
    );
  });

  it('montoNetoClp NaN → throw', () => {
    expect(() =>
      calcularTarifaProntoPago({ montoNetoClp: Number.NaN, plazoDiasShipper: 30 }),
    ).toThrow(/finito/);
  });

  it('montoNetoClp Infinity → throw', () => {
    expect(() =>
      calcularTarifaProntoPago({
        montoNetoClp: Number.POSITIVE_INFINITY,
        plazoDiasShipper: 30,
      }),
    ).toThrow(/finito/);
  });

  it('montoNetoClp float → throw', () => {
    expect(() => calcularTarifaProntoPago({ montoNetoClp: 100.5, plazoDiasShipper: 30 })).toThrow(
      /integer/,
    );
  });

  it('plazoDiasShipper 0 → throw', () => {
    expect(() => calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 0 })).toThrow(
      /> 0/,
    );
  });

  it('plazoDiasShipper negativo → throw', () => {
    expect(() =>
      calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: -30 }),
    ).toThrow(/> 0/);
  });

  it('plazoDiasShipper float → throw', () => {
    expect(() =>
      calcularTarifaProntoPago({ montoNetoClp: 100_000, plazoDiasShipper: 30.5 }),
    ).toThrow(/integer/);
  });
});
