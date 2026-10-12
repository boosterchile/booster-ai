import { factorWtw } from '@booster-ai/carbon-calculator';
import { describe, expect, it } from 'vitest';
import { type RutaCandidata, evaluarAlternativas } from './evaluar-alternativas.js';

const actual: RutaCandidata = {
  duracionSegundos: 3600,
  distanciaKm: 60,
  combustibleL: 20,
  polylineCodificada: 'actual',
};
const wtwDiesel = factorWtw('diesel');

describe('evaluarAlternativas — emisiones primero, con guardrail de ETA', () => {
  it('recomienda la alternativa de menor CO2e que no empeora la ETA más del guardrail', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [
        { duracionSegundos: 3300, distanciaKm: 58, combustibleL: 17, polylineCodificada: 'a' },
        { duracionSegundos: 3800, distanciaKm: 55, combustibleL: 15, polylineCodificada: 'b' }, // +5,6 % ETA: dentro
        { duracionSegundos: 4500, distanciaKm: 50, combustibleL: 12, polylineCodificada: 'c' }, // +25 % ETA: fuera
      ],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
    });
    expect(r.tipo).toBe('recomendada');
    if (r.tipo === 'recomendada') {
      expect(r.alternativa.polylineCodificada).toBe('b');
      expect(r.motivo).toBe('emisiones');
      expect(r.kgco2eActual).toBeCloseTo(20 * wtwDiesel, 6);
      expect(r.ahorroKgco2e).toBeCloseTo(5 * wtwDiesel, 6);
      expect(r.ahorroSegundos).toBe(-200);
    }
  });

  it('ninguna: sin alternativas', () => {
    expect(
      evaluarAlternativas({
        actual,
        alternativas: [],
        combustible: 'diesel',
        consumoBaseLPor100km: null,
      }),
    ).toEqual({ tipo: 'ninguna', razon: 'sin_alternativas' });
  });

  it('ninguna: la mejora no supera el 10 % ni en CO2e ni en tiempo', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [
        { duracionSegundos: 3500, distanciaKm: 59, combustibleL: 19.5, polylineCodificada: 'a' },
      ],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
    });
    expect(r).toEqual({ tipo: 'ninguna', razon: 'sin_mejora_material' });
  });

  it('recomienda por tiempo si ahorra >10 % de ETA sin emitir más', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [
        { duracionSegundos: 3000, distanciaKm: 60, combustibleL: 20, polylineCodificada: 'a' },
      ],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
    });
    expect(r).toMatchObject({ tipo: 'recomendada', motivo: 'tiempo', ahorroSegundos: 600 });
  });

  it('nunca recomienda una ruta que emite más aunque sea más rápida', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [
        { duracionSegundos: 2400, distanciaKm: 80, combustibleL: 26, polylineCodificada: 'a' },
      ],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
    });
    expect(r).toEqual({ tipo: 'ninguna', razon: 'sin_mejora_material' });
  });

  it('sin combustible de Routes API usa el consumo base del vehículo por distancia', () => {
    const sinFuel = (d: number, km: number, p: string): RutaCandidata => ({
      duracionSegundos: d,
      distanciaKm: km,
      combustibleL: null,
      polylineCodificada: p,
    });
    const r = evaluarAlternativas({
      actual: sinFuel(3600, 60, 'actual'),
      alternativas: [sinFuel(3700, 45, 'corta')],
      combustible: 'diesel',
      consumoBaseLPor100km: 30,
    });
    expect(r).toMatchObject({ tipo: 'recomendada', motivo: 'emisiones' });
    if (r.tipo === 'recomendada') {
      expect(r.ahorroKgco2e).toBeCloseTo((60 - 45) * 0.3 * wtwDiesel, 6);
    }
  });

  it('sin forma de estimar combustible evalúa solo por tiempo y no informa CO2e', () => {
    const sinFuel = { ...actual, combustibleL: null };
    const r = evaluarAlternativas({
      actual: sinFuel,
      alternativas: [{ ...sinFuel, duracionSegundos: 3000, polylineCodificada: 'a' }],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
    });
    expect(r).toEqual({
      tipo: 'recomendada',
      motivo: 'tiempo',
      alternativa: { ...sinFuel, duracionSegundos: 3000, polylineCodificada: 'a' },
      ahorroSegundos: 600,
      kgco2eActual: null,
      kgco2eAlternativa: null,
      ahorroKgco2e: null,
    });
  });

  it('eléctrico: los litros de Routes API no aplican; evalúa por tiempo', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [{ ...actual, duracionSegundos: 3000, polylineCodificada: 'a' }],
      combustible: 'electrico',
      consumoBaseLPor100km: null,
    });
    expect(r).toMatchObject({ tipo: 'recomendada', motivo: 'tiempo', kgco2eActual: null });
  });

  it('acepta guardrail y mejora mínima configurables', () => {
    const r = evaluarAlternativas({
      actual,
      alternativas: [
        { duracionSegundos: 4500, distanciaKm: 50, combustibleL: 12, polylineCodificada: 'c' },
      ],
      combustible: 'diesel',
      consumoBaseLPor100km: null,
      config: { guardrailEtaPct: 0.3 },
    });
    expect(r).toMatchObject({ tipo: 'recomendada', motivo: 'emisiones' });
  });
});
