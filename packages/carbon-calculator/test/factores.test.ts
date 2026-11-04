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

  it('diésel: GLEC v2.0 (2019) Tabla 32 EU → TTW 2,67 · WTT 0,57 · WTW 3,24 kg CO2e/L (HC-003)', () => {
    const f = obtenerFactorEmision('diesel');
    expect(f.unidad).toBe('L');
    expect(f.ttwKgco2e).toBe(2.67);
    expect(f.wttKgco2e).toBe(0.57);
    expect(factorWtw('diesel')).toBeCloseTo(3.24, 10);
    expect(f.fuente).toBe(
      'GLEC Framework v2.0 (2019), ISBN 978-90-82-68790-3, Módulo 1, Tabla 32 (EU), p. 87',
    );
  });

  it('híbrido diésel = 0,7 × diésel en TTW y WTT, y cita la misma tabla (HC-003)', () => {
    const h = obtenerFactorEmision('hibrido_diesel');
    expect(h.ttwKgco2e).toBeCloseTo(0.7 * 2.67, 10);
    expect(h.wttKgco2e).toBeCloseTo(0.7 * 0.57, 10);
    expect(h.fuente).toContain('Tabla 32');
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
    expect(f2.ttwKgco2e).toBe(2.67);
  });
});
