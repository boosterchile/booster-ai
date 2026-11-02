import { describe, expect, it } from 'vitest';
import {
  KM_MINIMOS_KM_POR_LITRO,
  LITROS_MINIMOS_KM_POR_LITRO,
  kmPorLitroMaxConfiable,
  litrosPor100KmSinRedondear,
  rendimiento,
  rendimientoAgregado,
  superaTopeConfiable,
} from './rendimiento.js';

describe('rendimiento', () => {
  it('km/L a 2 decimales y L/100 km a 1, de los mismos km y litros', () => {
    expect(rendimiento(42.5, 10)).toEqual({ kmPorLitro: 4.25, litrosPor100Km: 23.5 });
  });

  it('el L/100 km no sale del km/L redondeado', () => {
    // 100 / 3,34 = 29,94 → «29,9». La cuenta directa da 29,99 → 30,0.
    const r = rendimiento(100.05, 30);
    expect(r?.kmPorLitro).toBe(3.34);
    expect(r?.litrosPor100Km).toBe(30);
  });

  it('reproduce el 12,29 de JLKT54 (294,93 km / 24,0 L)', () => {
    expect(rendimiento(294.93, 24)?.kmPorLitro).toBe(12.29);
  });

  it('sin litros, sin km o con valores no finitos devuelve null', () => {
    expect(rendimiento(100, 0)).toBeNull();
    expect(rendimiento(100, -1)).toBeNull();
    expect(rendimiento(0, 10)).toBeNull();
    expect(rendimiento(null, 10)).toBeNull();
    expect(rendimiento(100, null)).toBeNull();
    expect(rendimiento(Number.NaN, 10)).toBeNull();
    expect(rendimiento(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('L/100 km sin redondear para comparar contra umbrales', () => {
    expect(litrosPor100KmSinRedondear(348.9, 137.5)).toBeCloseTo(39.4096, 4);
    expect(litrosPor100KmSinRedondear(0, 10)).toBeNull();
    expect(litrosPor100KmSinRedondear(100, null)).toBeNull();
  });
});

describe('rendimientoAgregado', () => {
  it('es Σkm/ΣL, no el promedio de los cocientes', () => {
    // 300/100 = 3 y 60/10 = 6: el promedio daría 4,5.
    expect(
      rendimientoAgregado([
        { km: 300, litros: 100 },
        { km: 60, litros: 10 },
      ]),
    ).toEqual({ kmPorLitro: 3.27, litrosPor100Km: 30.6 });
  });

  it('sin tramos o sin litros devuelve null', () => {
    expect(rendimientoAgregado([])).toBeNull();
    expect(rendimientoAgregado([{ km: 10, litros: 0 }])).toBeNull();
  });
});

describe('tope confiable', () => {
  it('es 2 × 100 / 32 = 6,25 y el valor que lo iguala se muestra', () => {
    expect(kmPorLitroMaxConfiable()).toBeCloseTo(6.25, 10);
    expect(superaTopeConfiable(6.25)).toBe(false);
    expect(superaTopeConfiable(6.26)).toBe(true);
    expect(superaTopeConfiable(12.29)).toBe(true);
  });

  it('la muestra mínima sigue en 5 L y 10 km', () => {
    expect(LITROS_MINIMOS_KM_POR_LITRO).toBe(5);
    expect(KM_MINIMOS_KM_POR_LITRO).toBe(10);
  });
});
