import { describe, expect, it } from 'vitest';
import { esCoordenadaGpsValida } from '../../src/services/coordenada-gps.js';

describe('esCoordenadaGpsValida', () => {
  it('coordenada chilena válida → true', () => {
    expect(esCoordenadaGpsValida(-33.45, -70.66)).toBe(true); // Santiago
    expect(esCoordenadaGpsValida(-29.99, -71.34)).toBe(true); // Coquimbo
    expect(esCoordenadaGpsValida(-53.16, -70.92)).toBe(true); // Punta Arenas
  });

  it('null island (0,0) → false', () => {
    expect(esCoordenadaGpsValida(0, 0)).toBe(false);
  });

  it('lat=0 con lng válido → false', () => {
    expect(esCoordenadaGpsValida(0, -70.66)).toBe(false);
  });

  it('lng=0 con lat válido → false', () => {
    expect(esCoordenadaGpsValida(-33.45, 0)).toBe(false);
  });

  it('NaN / Infinity → false', () => {
    expect(esCoordenadaGpsValida(Number.NaN, -70)).toBe(false);
    expect(esCoordenadaGpsValida(-33, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
