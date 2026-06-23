import { describe, expect, it } from 'vitest';
import { detectarDegradacion } from './index.js';

describe('detectarDegradacion', () => {
  it('no degradado si ETA en vivo ≈ baseline', () => {
    expect(
      detectarDegradacion({
        etaEnVivoSegundos: 1000,
        etaBaselineSegundos: 1000,
        segundosHastaProximaDivergencia: 300,
      }),
    ).toEqual({ degradado: false });
  });
  it('degradado si ETA en vivo supera baseline por > umbral (15%) y hay lead time', () => {
    const r = detectarDegradacion({
      etaEnVivoSegundos: 1200,
      etaBaselineSegundos: 1000,
      segundosHastaProximaDivergencia: 300,
    });
    expect(r.degradado).toBe(true);
    if (r.degradado) {
      expect(r.severidadPct).toBeCloseTo(0.2);
    }
  });
  it('NO degradado si la degradación llega pero NO hay lead time (ya pasó el cruce)', () => {
    expect(
      detectarDegradacion({
        etaEnVivoSegundos: 1200,
        etaBaselineSegundos: 1000,
        segundosHastaProximaDivergencia: 30,
      }),
    ).toEqual({ degradado: false });
  });
  it('umbral configurable', () => {
    expect(
      detectarDegradacion(
        {
          etaEnVivoSegundos: 1100,
          etaBaselineSegundos: 1000,
          segundosHastaProximaDivergencia: 300,
        },
        { umbralDegradacionPct: 0.05 },
      ).degradado,
    ).toBe(true);
  });
});
