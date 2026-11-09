import { describe, expect, it } from 'vitest';
import {
  TABLA_FACTORES_CERTIFICADO,
  factorWtw,
  factoresLineaCertificado,
  obtenerFactorEmision,
} from '../src/index.js';

describe('tabla versionada de factores del certificado (HC-004, opción d)', () => {
  it('criterio 13: cada fila cumple TTW + WTT = WTW', () => {
    for (const f of TABLA_FACTORES_CERTIFICADO) {
      expect(Math.round((f.ttw + f.wtt) * 1000) / 1000, f.fuente).toBe(f.wtw);
    }
  });

  it('las claves vigentes (diésel e híbrido diésel) están en la tabla con sus valores', () => {
    for (const c of ['diesel', 'hibrido_diesel'] as const) {
      const linea = factoresLineaCertificado(obtenerFactorEmision(c).fuente, factorWtw(c));
      expect(linea, c).not.toBeNull();
      expect(linea?.ttw).toBeCloseTo(obtenerFactorEmision(c).ttwKgco2e, 6);
      expect(linea?.wtt).toBeCloseTo(obtenerFactorEmision(c).wttKgco2e, 6);
    }
    expect(factoresLineaCertificado(obtenerFactorEmision('diesel').fuente, 3.24)).toEqual({
      fuente: obtenerFactorEmision('diesel').fuente,
      etiqueta: 'GLEC v2.0 (2019), Tabla 32',
      ttw: 2.67,
      wtt: 0.57,
      wtw: 3.24,
    });
  });

  it('si el factor usado no calza con la fila → null (no se imprime)', () => {
    expect(factoresLineaCertificado(obtenerFactorEmision('diesel').fuente, 3.25)).toBeNull();
  });

  it('fuente desconocida o ausente → null', () => {
    expect(factoresLineaCertificado('SEC Chile 2024 + GLEC v3.0', 3.25)).toBeNull();
    expect(factoresLineaCertificado(null, 3.24)).toBeNull();
  });
});
