import { describe, expect, it } from 'vitest';
import { factorWtw, obtenerFactorEmision } from '../src/factores/sec-chile-2024.js';
import type { TipoCombustible } from '../src/tipos.js';

describe('Factores de emisión Chile 2024', () => {
  it('expone los 8 tipos de combustible del enum', () => {
    const tipos: TipoCombustible[] = [
      'diesel',
      'gasolina',
      'gas_glp',
      'gas_gnc',
      'electrico',
      'hibrido_diesel',
      'hibrido_gasolina',
      'hidrogeno',
    ];
    for (const t of tipos) {
      const f = obtenerFactorEmision(t);
      expect(f.combustible).toBe(t);
      expect(f.anioReferencia).toBe(2024);
      expect(f.fuente).toBeTruthy();
      expect(f.energyMjPerUnit).toBeGreaterThan(0);
    }
  });

  it('diésel B5 tiene factor WTW ~3.25 kgCO2e/L (GLEC v3.0 + IPCC AR6)', () => {
    const f = obtenerFactorEmision('diesel');
    expect(f.unidad).toBe('L');
    // TTW: 2.68 (CO2 puro) + 0.02 (CH4+N2O × GWP-100 AR6) = 2.70
    expect(f.ttwKgco2e).toBeCloseTo(2.7, 2);
    // WTT: 0.55 alineado GLEC EU diesel (Climatiq) y Chile B5
    expect(f.wttKgco2e).toBeCloseTo(0.55, 2);
    // WTW total = 3.25 (vs 3.24 que reporta Climatiq para EU GLEC v2.0)
    expect(factorWtw('diesel')).toBeCloseTo(3.25, 2);
  });

  it('gasolina tiene factor WTW ~2.76 kgCO2e/L', () => {
    expect(factorWtw('gasolina')).toBeCloseTo(2.76, 2);
  });

  it('eléctrico no tiene TTW (sin combustión local)', () => {
    const f = obtenerFactorEmision('electrico');
    expect(f.ttwKgco2e).toBe(0);
    expect(f.wttKgco2e).toBeGreaterThan(0); // grid genera CO2e
    expect(f.unidad).toBe('kWh');
  });

  it('hidrógeno (gris) tiene TTW=0 pero WTT alto', () => {
    const f = obtenerFactorEmision('hidrogeno');
    expect(f.ttwKgco2e).toBe(0);
    expect(f.wttKgco2e).toBeGreaterThan(5);
    expect(f.unidad).toBe('kg');
  });

  it('híbridos son ~70% del factor del combustible puro', () => {
    expect(factorWtw('hibrido_diesel') / factorWtw('diesel')).toBeCloseTo(0.7, 1);
    expect(factorWtw('hibrido_gasolina') / factorWtw('gasolina')).toBeCloseTo(0.7, 1);
  });

  it('obtenerFactorEmision devuelve copia inmutable (defensa)', () => {
    const f = obtenerFactorEmision('diesel');
    f.ttwKgco2e = 999;
    const f2 = obtenerFactorEmision('diesel');
    expect(f2.ttwKgco2e).toBeCloseTo(2.7, 2);
  });
});
