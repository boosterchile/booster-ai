import { describe, expect, it } from 'vitest';
import {
  DENSITY_DEFAULT,
  DENSITY_KEYS,
  REGISTER_DEFAULT,
  REGISTER_KEYS,
  densityScales,
  registerScales,
} from './register.js';

describe('registro/densidad (tokens)', () => {
  it('expone los dos registros y las dos densidades', () => {
    expect(REGISTER_KEYS).toEqual(['operador', 'conductor']);
    expect(DENSITY_KEYS).toEqual(['comoda', 'compacta']);
    expect(REGISTER_DEFAULT).toBe('operador');
    expect(DENSITY_DEFAULT).toBe('comoda');
  });

  it('conductor es más holgado que operador (guantes/movimiento, §4.1)', () => {
    expect(registerScales.conductor.touchMin).toBe('56px');
    expect(registerScales.operador.touchMin).toBe('44px');
    // el operador nunca baja del piso WCAG de 44px
    for (const key of REGISTER_KEYS) {
      expect(Number.parseInt(registerScales[key].touchMin, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it('la densidad compacta reduce, la cómoda es neutra (multiplicador)', () => {
    expect(densityScales.comoda).toBe('1');
    expect(Number.parseFloat(densityScales.compacta)).toBeLessThan(1);
  });
});
