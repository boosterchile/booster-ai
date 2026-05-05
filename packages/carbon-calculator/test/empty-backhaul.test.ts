import { describe, expect, it } from 'vitest';
import { calcularEmptyBackhaul } from '../src/glec/empty-backhaul.js';
import { calcularModelado } from '../src/modos/modelado.js';

describe('calcularEmptyBackhaul — GLEC v3.0 §6.4', () => {
  const params = {
    distanciaRetornoKm: 500,
    consumoBasePor100km: 28,
    combustible: 'diesel' as const,
    capacidadKg: 25000,
  };

  it('factorMatching=0 (sin matching) atribuye 100% del retorno vacío al shipment', () => {
    const r = calcularEmptyBackhaul({ ...params, factorMatching: 0 });
    // Consumo vacío: 28 × 0.95 (MDV α=0.10, ratio=0) = 26.6 L/100km
    // Total: 26.6 × 5 = 133 L
    // Emisiones: 133 × 3.25 = 432.25 kg CO2e (al shipment)
    expect(r.distanciaVaciaKm).toBeCloseTo(500, 1);
    expect(r.combustibleConsumido).toBeCloseTo(133, 0);
    expect(r.emisionesKgco2eWtw).toBeCloseTo(432.25, 0);
    // El ahorro vs "sin matching" es 0 porque ya estamos en sin matching.
    expect(r.ahorroVsSinMatchingKgco2e).toBeCloseTo(0, 1);
  });

  it('factorMatching=1 (matching perfecto) no atribuye empty backhaul', () => {
    const r = calcularEmptyBackhaul({ ...params, factorMatching: 1 });
    expect(r.distanciaVaciaKm).toBe(0);
    expect(r.combustibleConsumido).toBe(0);
    expect(r.emisionesKgco2eWtw).toBe(0);
    // Ahorro: todo el retorno vacío que se evitó.
    expect(r.ahorroVsSinMatchingKgco2e).toBeGreaterThan(400);
  });

  it('factorMatching=0.7 (matching parcial) escala linealmente', () => {
    const sinMatching = calcularEmptyBackhaul({ ...params, factorMatching: 0 });
    const conMatching = calcularEmptyBackhaul({ ...params, factorMatching: 0.7 });
    // Distancia vacía debería ser 30% de la de sin matching.
    expect(conMatching.distanciaVaciaKm).toBeCloseTo(sinMatching.distanciaVaciaKm * 0.3, 1);
    expect(conMatching.emisionesKgco2eWtw).toBeCloseTo(sinMatching.emisionesKgco2eWtw * 0.3, 0);
    // Ahorro debe ser 70% del worst case.
    expect(conMatching.ahorroVsSinMatchingKgco2e).toBeCloseTo(
      sinMatching.emisionesKgco2eWtw * 0.7,
      0,
    );
  });

  it('rechaza factorMatching fuera de [0, 1]', () => {
    expect(() => calcularEmptyBackhaul({ ...params, factorMatching: -0.1 })).toThrow();
    expect(() => calcularEmptyBackhaul({ ...params, factorMatching: 1.1 })).toThrow();
  });

  it('rechaza distanciaRetornoKm negativa', () => {
    expect(() =>
      calcularEmptyBackhaul({ ...params, distanciaRetornoKm: -1, factorMatching: 0.5 }),
    ).toThrow();
  });

  it('categoría HDV usa α=0.15 — consumo vacío más bajo que MDV', () => {
    const mdv = calcularEmptyBackhaul({ ...params, factorMatching: 0, categoria: 'MDV' });
    const hdv = calcularEmptyBackhaul({ ...params, factorMatching: 0, categoria: 'HDV' });
    // HDV con α=0.15 → corrección vacío = 1 + 0.15 × (0 − 0.5) = 0.925
    // MDV con α=0.10 → corrección vacío = 1 + 0.10 × (0 − 0.5) = 0.95
    // HDV consume MENOS al vaciarse que MDV → menos emisiones empty backhaul.
    expect(hdv.emisionesKgco2eWtw).toBeLessThan(mdv.emisionesKgco2eWtw);
  });
});

describe('calcularModelado con backhaul — integración GLEC v3.0', () => {
  const baseParams = {
    metodo: 'modelado' as const,
    distanciaKm: 500,
    cargaKg: 12000,
    vehiculo: {
      combustible: 'diesel' as const,
      consumoBasePor100km: 28,
      pesoVacioKg: 8000,
      capacidadKg: 25000,
    },
  };

  it('sin backhaul: result.backhaul es undefined', () => {
    const r = calcularModelado(baseParams);
    expect(r.backhaul).toBeUndefined();
  });

  it('con backhaul: incluye desglose del leg vacío y ahorro', () => {
    const r = calcularModelado({
      ...baseParams,
      backhaul: { distanciaRetornoKm: 500, factorMatching: 0.7 },
    });
    expect(r.backhaul).toBeDefined();
    expect(r.backhaul?.factorMatchingAplicado).toBeCloseTo(0.7, 2);
    expect(r.backhaul?.emisionesKgco2eWtw).toBeGreaterThan(0);
    expect(r.backhaul?.ahorroVsSinMatchingKgco2e).toBeGreaterThan(0);
    // intensidadConBackhaul incluye loaded + empty leg attributable
    expect(r.backhaul?.intensidadConBackhaulGco2ePorTonKm).toBeGreaterThan(
      r.intensidadGco2ePorTonKm,
    );
  });

  it('matching perfecto: ahorro = emisiones del retorno vacío completo', () => {
    const r = calcularModelado({
      ...baseParams,
      backhaul: { distanciaRetornoKm: 500, factorMatching: 1 },
    });
    expect(r.backhaul?.emisionesKgco2eWtw).toBe(0);
    // El ahorro debe ser sustancial — todo el retorno evitado.
    expect(r.backhaul?.ahorroVsSinMatchingKgco2e).toBeGreaterThan(400);
    // Sin empty backhaul efectivo, intensidad con/sin backhaul es ~igual.
    expect(r.backhaul?.intensidadConBackhaulGco2ePorTonKm).toBeCloseTo(
      r.intensidadGco2ePorTonKm,
      0,
    );
  });

  it('sin matching: intensidad con backhaul casi duplica la de solo loaded', () => {
    const r = calcularModelado({
      ...baseParams,
      backhaul: { distanciaRetornoKm: 500, factorMatching: 0 },
    });
    // Loaded intensidad ~ X. Con retorno vacío atribuido casi se suma una
    // cantidad similar (consumo vacío ~95% del cargado por correccion).
    const ratio = (r.backhaul?.intensidadConBackhaulGco2ePorTonKm ?? 0) / r.intensidadGco2ePorTonKm;
    expect(ratio).toBeGreaterThan(1.7);
    expect(ratio).toBeLessThan(2.0);
  });
});
