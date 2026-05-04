import { describe, expect, it } from 'vitest';
import { PricingValidationError, computePricingSuggestion } from '../src/index.js';

describe('computePricingSuggestion — casos calibrados', () => {
  it('Santiago → Concepción típico (530 km, 5t construcción)', () => {
    const result = computePricingSuggestion({
      distanceKm: 530,
      weightKg: 5000,
      cargoType: 'construccion',
      urgency: 'standard',
      volumeM3: 25,
    });
    expect(result.totalClp).toBeGreaterThan(500_000);
    expect(result.totalClp).toBeLessThan(800_000);
    expect(result.totalClp % 1000).toBe(0); // redondeado a 1000
    expect(result.confidence).toBe('high');
  });

  it('mismo viaje urgencia express sube ~25%', () => {
    const standard = computePricingSuggestion({
      distanceKm: 530,
      weightKg: 5000,
      cargoType: 'construccion',
      urgency: 'standard',
      volumeM3: 25,
    });
    const express = computePricingSuggestion({
      distanceKm: 530,
      weightKg: 5000,
      cargoType: 'construccion',
      urgency: 'express',
      volumeM3: 25,
    });
    const ratio = express.totalClp / standard.totalClp;
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.3);
  });

  it('viaje crítico sube ~60%', () => {
    const standard = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 5,
    });
    const critical = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
      urgency: 'critical',
      volumeM3: 5,
    });
    const ratio = critical.totalClp / standard.totalClp;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(1.7);
  });

  it('flexible da 10% descuento vs standard', () => {
    const standard = computePricingSuggestion({
      distanceKm: 200,
      weightKg: 2000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 10,
    });
    const flexible = computePricingSuggestion({
      distanceKm: 200,
      weightKg: 2000,
      cargoType: 'general',
      urgency: 'flexible',
      volumeM3: 10,
    });
    const ratio = flexible.totalClp / standard.totalClp;
    expect(ratio).toBeLessThan(1.0);
    expect(ratio).toBeGreaterThan(0.85);
  });

  it('peligrosa cuesta más que general (1.5x cargo multiplier)', () => {
    const general = computePricingSuggestion({
      distanceKm: 300,
      weightKg: 3000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 15,
    });
    const peligrosa = computePricingSuggestion({
      distanceKm: 300,
      weightKg: 3000,
      cargoType: 'peligrosa',
      urgency: 'standard',
      volumeM3: 15,
    });
    expect(peligrosa.totalClp).toBeGreaterThan(general.totalClp * 1.4);
    expect(peligrosa.totalClp).toBeLessThan(general.totalClp * 1.6);
  });

  it('frigorifica == frio == 1.4x', () => {
    const frigorifica = computePricingSuggestion({
      distanceKm: 200,
      weightKg: 1000,
      cargoType: 'frigorifica',
      urgency: 'standard',
    });
    const frio = computePricingSuggestion({
      distanceKm: 200,
      weightKg: 1000,
      cargoType: 'frio',
      urgency: 'standard',
    });
    expect(frigorifica.totalClp).toBe(frio.totalClp);
  });

  it('one-way empty agrega 20%', () => {
    const ida = computePricingSuggestion({
      distanceKm: 500,
      weightKg: 4000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 20,
      isOneWayEmpty: false,
    });
    const idaVuelta = computePricingSuggestion({
      distanceKm: 500,
      weightKg: 4000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 20,
      isOneWayEmpty: true,
    });
    expect(idaVuelta.totalClp).toBeGreaterThan(ida.totalClp);
    const ratio = idaVuelta.totalClp / ida.totalClp;
    expect(ratio).toBeGreaterThan(1.15);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe('computePricingSuggestion — confidence', () => {
  it('volumen + cargoType conocido → high', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
      volumeM3: 5,
    });
    expect(r.confidence).toBe('high');
  });

  it('sin volumen pero cargo conocido → medium', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
    });
    expect(r.confidence).toBe('medium');
  });

  it('cargo "otra" pero con volumen → medium', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'otra',
      volumeM3: 5,
    });
    expect(r.confidence).toBe('medium');
  });

  it('sin volumen + cargo "otra" → low', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'otra',
    });
    expect(r.confidence).toBe('low');
  });
});

describe('computePricingSuggestion — breakdown', () => {
  it('subtotalClp es suma de componentes pre-multipliers', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 5,
    });
    const expectedSubtotal =
      r.breakdown.baseFeeClp +
      r.breakdown.distanceClp +
      r.breakdown.weightClp +
      r.breakdown.volumeClp;
    // Permitimos error de redondeo de 1 (subtotalClp redondea cada componente
    // separado y el subtotal acumula).
    expect(Math.abs(r.breakdown.subtotalClp - expectedSubtotal)).toBeLessThanOrEqual(2);
  });

  it('multipliers se exponen en el breakdown', () => {
    const r = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'peligrosa',
      urgency: 'express',
      isOneWayEmpty: true,
    });
    expect(r.breakdown.multipliers.cargoType).toBe(1.5);
    expect(r.breakdown.multipliers.urgency).toBe(1.25);
    expect(r.breakdown.multipliers.oneWayEmpty).toBe(1.2);
  });
});

describe('computePricingSuggestion — config override', () => {
  it('override de baseFeeClp se respeta', () => {
    const defaultR = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 1000,
      cargoType: 'general',
      urgency: 'standard',
    });
    const customR = computePricingSuggestion(
      {
        distanceKm: 100,
        weightKg: 1000,
        cargoType: 'general',
        urgency: 'standard',
      },
      { baseFeeClp: 200_000 },
    );
    expect(customR.totalClp).toBeGreaterThan(defaultR.totalClp);
  });

  it('override parcial de cargoMultipliers', () => {
    const r = computePricingSuggestion(
      {
        distanceKm: 100,
        weightKg: 1000,
        cargoType: 'peligrosa',
        urgency: 'standard',
      },
      { cargoMultipliers: { peligrosa: 2.0 } },
    );
    expect(r.breakdown.multipliers.cargoType).toBe(2.0);
  });
});

describe('computePricingSuggestion — validación Zod', () => {
  it('rechaza distanceKm 0', () => {
    expect(() =>
      computePricingSuggestion({
        distanceKm: 0,
        weightKg: 1000,
        cargoType: 'general',
      }),
    ).toThrowError(PricingValidationError);
  });

  it('rechaza weightKg negativo', () => {
    expect(() =>
      computePricingSuggestion({
        distanceKm: 100,
        weightKg: -1,
        cargoType: 'general',
      }),
    ).toThrowError(PricingValidationError);
  });

  it('rechaza cargoType inválido', () => {
    expect(() =>
      computePricingSuggestion({
        distanceKm: 100,
        weightKg: 1000,
        cargoType: 'wat' as unknown as 'general',
      }),
    ).toThrowError(PricingValidationError);
  });

  it('rechaza urgency inválida', () => {
    expect(() =>
      computePricingSuggestion({
        distanceKm: 100,
        weightKg: 1000,
        cargoType: 'general',
        urgency: 'wat' as unknown as 'standard',
      }),
    ).toThrowError(PricingValidationError);
  });
});

describe('computePricingSuggestion — volumen vs peso', () => {
  it('cuando volumen explícito > volumen-from-peso, usa el explícito', () => {
    // Carga liviana pero voluminosa (ej. cojines): peso=200, volumen=20m³
    // volumen-from-peso = 200/200 = 1m³. Cobramos por 20m³.
    const liviana = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 200,
      cargoType: 'general',
      urgency: 'standard',
      volumeM3: 20,
    });
    const sinVolumen = computePricingSuggestion({
      distanceKm: 100,
      weightKg: 200,
      cargoType: 'general',
      urgency: 'standard',
    });
    expect(liviana.totalClp).toBeGreaterThan(sinVolumen.totalClp);
  });
});
