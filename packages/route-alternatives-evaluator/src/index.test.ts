import { describe, expect, it, vi } from 'vitest';

// Mocking @booster-ai/carbon-calculator with faithful signatures.
//
// Real signatures:
//   calcularEmisionesViaje(params: ParametrosCalculo): ResultadoEmisiones
//     — ParametrosCalculo is ParametrosModelado | ParametrosExactoCanbus | ParametrosPorDefecto
//     — ResultadoEmisiones.emisionesKgco2eWtw is the CO2e total in kg
//   factorWtw(combustible: TipoCombustible): number
//     — returns ttw + wtt for the given fuel (e.g. diesel → 3.25 kg CO2e/L)
//
// We mock factorWtw to return 3.25 (real diesel WTW = 2.7 + 0.55).
// We mock calcularEmisionesViaje to return distanciaKm * 0.325 (deterministic estimate).
// The evaluator uses factorWtw when fuelLitros is non-null, and calcularEmisionesViaje
// when fuelLitros is null.
vi.mock('@booster-ai/carbon-calculator', () => ({
  factorWtw: (_combustible: string) => 3.25,
  calcularEmisionesViaje: (params: {
    metodo: string;
    distanciaKm: number;
    vehiculo: {
      combustible: string;
      consumoBasePor100km: number | null;
      pesoVacioKg: number | null;
      capacidadKg: number;
    };
    cargaKg: number;
  }) => ({
    emisionesKgco2eWtw: params.distanciaKm * 0.325,
    emisionesKgco2eTtw: params.distanciaKm * 0.27,
    emisionesKgco2eWtt: params.distanciaKm * 0.055,
    combustibleConsumido: params.distanciaKm * 0.1,
    unidadCombustible: 'L',
    distanciaKm: params.distanciaKm,
    intensidadGco2ePorTonKm: 93,
    metodoPrecision: 'modelado',
    factorEmisionUsado: 3.25,
    versionGlec: '3.0',
    fuenteFactores: 'SEC-Chile-2024',
  }),
}));

import { evaluarAlternativas } from './index.js';

// With mock: fuelLitros-based emission = fuelLitros * factorWtw(diesel) = fuelLitros * 3.25
const actual = { polyline: 'A', distanciaKm: 10, duracionSegundos: 1200, fuelLitros: 2.0 };
// actual emission = 2.0 * 3.25 = 6.50 kg CO2e

describe('evaluarAlternativas', () => {
  it('elige la alternativa de menor CO2e dentro del guardrail de ETA', () => {
    // B: 1.5 * 3.25 = 4.875 kg CO2e < actual 6.50 → mejor
    // B duracion=1260s vs guardrail=1200*(1+0.10)=1320s → within guardrail → recomendada
    const r = evaluarAlternativas({
      alternativas: [
        actual,
        { polyline: 'B', distanciaKm: 11, duracionSegundos: 1260, fuelLitros: 1.5 },
      ],
      fuelType: 'diesel',
      guardrailEtaPct: 0.1,
    });
    expect(r).toEqual({
      tipo: 'recomendada',
      polyline: 'B',
      deltaEtaSegundos: 60,
      deltaCo2eKg: expect.closeTo((1.5 - 2.0) * 3.25, 5),
    });
  });

  it('descarta una alternativa más limpia pero que viola el guardrail de ETA (+10%)', () => {
    // C duracion=1400s vs guardrail=1200*1.10=1320s → exceeds → descartada
    // solo queda actual → ninguna_mejor
    const r = evaluarAlternativas({
      alternativas: [
        actual,
        { polyline: 'C', distanciaKm: 9, duracionSegundos: 1400, fuelLitros: 1.0 },
      ],
      fuelType: 'diesel',
      guardrailEtaPct: 0.1,
    });
    expect(r).toEqual({ tipo: 'ninguna_mejor' });
  });

  it('ninguna_mejor si la actual ya es la de menor emisión', () => {
    // D: 3.0 * 3.25 = 9.75 > actual 6.50 → actual is best → ninguna_mejor
    const r = evaluarAlternativas({
      alternativas: [
        actual,
        { polyline: 'D', distanciaKm: 12, duracionSegundos: 1260, fuelLitros: 3.0 },
      ],
      fuelType: 'diesel',
      guardrailEtaPct: 0.1,
    });
    expect(r).toEqual({ tipo: 'ninguna_mejor' });
  });

  it('estima emisiones via carbon-calculator cuando fuelLitros es null', () => {
    // E: fuelLitros=null → estimate via calcularEmisionesViaje → 8 * 0.325 = 2.60 kg CO2e
    // actual: 2.0 * 3.25 = 6.50 kg CO2e
    // E duracion=1100s vs guardrail=1200*1.10=1320s → within guardrail
    // E cheaper (2.60 < 6.50) → recomendada
    const altE = { polyline: 'E', distanciaKm: 8, duracionSegundos: 1100, fuelLitros: null };
    const r = evaluarAlternativas({
      alternativas: [actual, altE],
      fuelType: 'diesel',
      guardrailEtaPct: 0.1,
    });
    expect(r).toEqual({
      tipo: 'recomendada',
      polyline: 'E',
      deltaEtaSegundos: 1100 - 1200,
      deltaCo2eKg: expect.closeTo(8 * 0.325 - 2.0 * 3.25, 5),
    });
  });
});
