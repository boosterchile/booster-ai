import { describe, expect, it } from 'vitest';
import {
  MATCHING_TIME_WINDOW_HORAS,
  type ParametrosFactorMatching,
  calcularFactorMatching,
} from '../src/factor-matching.js';

const baseParams: ParametrosFactorMatching = {
  prevDestinoComunaCode: '13101',
  nextOrigenComunaCode: '13101',
  prevEntregadoEn: new Date('2026-05-05T10:00:00Z'),
  nextRecogidoEn: new Date('2026-05-05T11:00:00Z'),
  distanciaRetornoTotalKm: 100,
};

describe('calcularFactorMatching — rama EXACTA (Distance Matrix)', () => {
  it('factor=1 cuando el siguiente pickup está en el mismo punto del destino (0 km vacíos)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaPrevDestinoANextOrigenKm: 0,
    });
    expect(r).toEqual({ factor: 1, precision: 'exacto' });
  });

  it('factor=0.5 cuando el camión maneja vacío la mitad del retorno', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 100,
      distanciaPrevDestinoANextOrigenKm: 50,
    });
    expect(r).toEqual({ factor: 0.5, precision: 'exacto' });
  });

  it('factor=0 cuando el siguiente pickup está al fin del retorno (100% vacío)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 100,
      distanciaPrevDestinoANextOrigenKm: 100,
    });
    expect(r).toEqual({ factor: 0, precision: 'exacto' });
  });

  it('factor=0 cuando el siguiente pickup está MÁS lejos que el retorno (carrier manejó MÁS vacío)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 100,
      distanciaPrevDestinoANextOrigenKm: 200,
    });
    // Clamp a 0: nunca atribuimos un factor negativo.
    expect(r).toEqual({ factor: 0, precision: 'exacto' });
  });

  it('factor=0.7 con números no triviales', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 250,
      distanciaPrevDestinoANextOrigenKm: 75,
    });
    expect(r.factor).toBeCloseTo(0.7, 5);
    expect(r.precision).toBe('exacto');
  });

  it('rama exacta gana sobre rama comuna cuando ambas señales están disponibles', () => {
    // Comunas distintas pero distancia precisa muy corta — debe usar exacto.
    const r = calcularFactorMatching({
      ...baseParams,
      prevDestinoComunaCode: '13101',
      nextOrigenComunaCode: '13125',
      distanciaRetornoTotalKm: 100,
      distanciaPrevDestinoANextOrigenKm: 5,
    });
    expect(r.precision).toBe('exacto');
    expect(r.factor).toBeCloseTo(0.95, 5);
  });
});

describe('calcularFactorMatching — rama COMUNA (fallback)', () => {
  it('factor=1 cuando origen del siguiente trip = destino del previo (misma comuna)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevDestinoComunaCode: '13101',
      nextOrigenComunaCode: '13101',
    });
    expect(r).toEqual({ factor: 1, precision: 'comuna' });
  });

  it('factor=0 con precision=comuna cuando comunas distintas (eval realizada, sin match)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevDestinoComunaCode: '13101',
      nextOrigenComunaCode: '05101',
    });
    expect(r).toEqual({ factor: 0, precision: 'comuna' });
  });
});

describe('calcularFactorMatching — sin_match (precondiciones no cumplidas)', () => {
  it('gap temporal > 4h corta el matching aunque comunas coincidan', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevEntregadoEn: new Date('2026-05-05T10:00:00Z'),
      nextRecogidoEn: new Date('2026-05-05T15:00:00Z'),
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('gap temporal exactamente en el threshold (4h) sigue siendo válido', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevEntregadoEn: new Date('2026-05-05T10:00:00Z'),
      nextRecogidoEn: new Date(`2026-05-05T${10 + MATCHING_TIME_WINDOW_HORAS}:00:00Z`),
    });
    expect(r.precision).toBe('comuna');
    expect(r.factor).toBe(1);
  });

  it('next pickup ANTES del previous delivery (orden temporal inválido)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevEntregadoEn: new Date('2026-05-05T12:00:00Z'),
      nextRecogidoEn: new Date('2026-05-05T10:00:00Z'),
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('distanciaRetornoTotalKm=0 (no hay retorno modelado) → no atribuible', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 0,
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('distanciaRetornoTotalKm negativo → defensivo, sin_match', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: -10,
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('distanciaRetornoTotalKm NaN → sin_match', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: Number.NaN,
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('comunas null y sin distancia exacta → sin_match', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevDestinoComunaCode: null,
      nextOrigenComunaCode: null,
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('una comuna null y la otra no → sin_match (no se puede evaluar identidad)', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      prevDestinoComunaCode: '13101',
      nextOrigenComunaCode: null,
    });
    expect(r).toEqual({ factor: 0, precision: 'sin_match' });
  });

  it('distanciaPrevDestinoANextOrigenKm negativa → ignorada, cae a comuna', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaPrevDestinoANextOrigenKm: -5,
    });
    // -5 ignorado por la guard, evalúa por comuna.
    expect(r.precision).toBe('comuna');
    expect(r.factor).toBe(1);
  });

  it('distanciaPrevDestinoANextOrigenKm NaN → ignorada, cae a comuna', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaPrevDestinoANextOrigenKm: Number.NaN,
    });
    expect(r.precision).toBe('comuna');
    expect(r.factor).toBe(1);
  });
});

describe('calcularFactorMatching — composición con calcularEmptyBackhaul', () => {
  // Este describe documenta el contrato río abajo: el `factor` que esta
  // función retorna es exactamente el `factorMatching` que consume el
  // calculator. Ver packages/carbon-calculator/src/glec/empty-backhaul.ts.
  it('precision=exacto produce un factor numérico ∈ [0, 1] válido para el calculator', () => {
    const r = calcularFactorMatching({
      ...baseParams,
      distanciaRetornoTotalKm: 200,
      distanciaPrevDestinoANextOrigenKm: 80,
    });
    expect(r.factor).toBeGreaterThanOrEqual(0);
    expect(r.factor).toBeLessThanOrEqual(1);
    expect(r.factor).toBeCloseTo(0.6, 5);
  });

  it('precision=comuna produce factor 0 ó 1 (identidad binaria)', () => {
    const match = calcularFactorMatching({ ...baseParams });
    const noMatch = calcularFactorMatching({
      ...baseParams,
      nextOrigenComunaCode: '99999',
    });
    expect([0, 1]).toContain(match.factor);
    expect([0, 1]).toContain(noMatch.factor);
  });
});
