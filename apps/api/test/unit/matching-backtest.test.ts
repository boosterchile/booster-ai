import { describe, expect, it } from 'vitest';
import {
  type ResultadoTripBacktest,
  computeResumen,
} from '../../src/services/matching-backtest.js';

/**
 * Tests del agregador puro `computeResumen` del backtest service.
 *
 * `runBacktest` (la función principal que toca DB) tiene tests de
 * integración aparte. Acá nos enfocamos en validar las métricas
 * derivadas: shape, edge cases, monotonicidad.
 */

function makeResultado(overrides: Partial<ResultadoTripBacktest> = {}): ResultadoTripBacktest {
  return {
    tripId: overrides.tripId ?? 'trip-1',
    originRegionCode: overrides.originRegionCode ?? 'RM',
    cargoWeightKg: overrides.cargoWeightKg ?? 5000,
    candidatosTotal: overrides.candidatosTotal ?? 3,
    ofertasV1: overrides.ofertasV1 ?? [
      { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 950 },
      { empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 850 },
    ],
    ofertasV2: overrides.ofertasV2 ?? [
      { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 920 },
      { empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 800 },
    ],
    overlapEmpresas: overrides.overlapEmpresas ?? 1, // emp-A en ambos
    deltaScorePromedio: overrides.deltaScorePromedio ?? 0.05,
    backhaulHit: overrides.backhaulHit ?? false,
  };
}

describe('computeResumen', () => {
  it('resultados vacío → todos los contadores en 0', () => {
    const resumen = computeResumen([]);
    expect(resumen).toEqual({
      tripsProcesados: 0,
      tripsConCandidatosV1: 0,
      tripsConCandidatosV2: 0,
      topNOverlapPct: 0,
      scoreDeltaAvg: 0,
      backhaulHitRatePct: 0,
      empresasFavorecidas: [],
      empresasPerjudicadas: [],
      distribucionScoresV2: {
        '0-200': 0,
        '200-400': 0,
        '400-600': 0,
        '600-800': 0,
        '800-1000': 0,
      },
    });
  });

  it('1 trip con candidatos → tripsProcesados=1 y conteos correctos', () => {
    const resumen = computeResumen([makeResultado()]);
    expect(resumen.tripsProcesados).toBe(1);
    expect(resumen.tripsConCandidatosV1).toBe(1);
    expect(resumen.tripsConCandidatosV2).toBe(1);
  });

  it('top-N overlap: 1 empresa en común de 2 ofertas v2 → 50%', () => {
    const resumen = computeResumen([
      makeResultado({
        ofertasV1: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 },
          { empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 800 },
        ],
        ofertasV2: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 920 },
          { empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 700 },
        ],
        overlapEmpresas: 1,
      }),
    ]);
    expect(resumen.topNOverlapPct).toBe(50);
  });

  it('top-N overlap: 0 empresas en común → 0%', () => {
    const resumen = computeResumen([
      makeResultado({
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 800 }],
        overlapEmpresas: 0,
      }),
    ]);
    expect(resumen.topNOverlapPct).toBe(0);
  });

  it('top-N overlap: 100% cuando v1 y v2 producen mismo set', () => {
    const resumen = computeResumen([
      makeResultado({
        ofertasV1: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 },
          { empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 800 },
        ],
        ofertasV2: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 950 },
          { empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 850 },
        ],
        overlapEmpresas: 2,
      }),
    ]);
    expect(resumen.topNOverlapPct).toBe(100);
  });

  it('scoreDeltaAvg: promedio de los deltas con valor ≠ 0', () => {
    const resumen = computeResumen([
      makeResultado({ deltaScorePromedio: 0.1 }),
      makeResultado({ tripId: 't-2', deltaScorePromedio: 0.2 }),
      makeResultado({ tripId: 't-3', deltaScorePromedio: 0 }), // ignorado
    ]);
    expect(resumen.scoreDeltaAvg).toBe(0.15);
  });

  it('backhaulHitRatePct: 2 de 4 trips con hit → 50%', () => {
    const resumen = computeResumen([
      makeResultado({ tripId: 't-1', backhaulHit: true }),
      makeResultado({ tripId: 't-2', backhaulHit: false }),
      makeResultado({ tripId: 't-3', backhaulHit: true }),
      makeResultado({ tripId: 't-4', backhaulHit: false }),
    ]);
    expect(resumen.backhaulHitRatePct).toBe(50);
  });

  it('empresasFavorecidas: empresa con +N slots en v2 vs v1 aparece primero', () => {
    // emp-C aparece 3 veces en v2 y 0 en v1 → delta +3 (más favorecida).
    // emp-A aparece 2 veces en v2 y 2 veces en v1 → delta 0 (no aparece).
    const resumen = computeResumen([
      makeResultado({
        tripId: 't-1',
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
      makeResultado({
        tripId: 't-2',
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
      makeResultado({
        tripId: 't-3',
        ofertasV1: [{ empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
    ]);
    expect(resumen.empresasFavorecidas[0]?.empresaId).toBe('emp-C');
    expect(resumen.empresasFavorecidas[0]?.delta).toBe(3);
  });

  it('empresasPerjudicadas: empresa con -N slots en v2 vs v1', () => {
    // emp-A: v1 lo elige 3 veces, v2 0 veces → delta -3.
    const resumen = computeResumen([
      makeResultado({
        tripId: 't-1',
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
      makeResultado({
        tripId: 't-2',
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
      makeResultado({
        tripId: 't-3',
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 950 }],
      }),
    ]);
    expect(resumen.empresasPerjudicadas[0]?.empresaId).toBe('emp-A');
    expect(resumen.empresasPerjudicadas[0]?.delta).toBe(-3);
  });

  it('empresasFavorecidas/perjudicadas: tope hard de 3 cada lista', () => {
    // 5 empresas perjudicadas, 5 favorecidas.
    const resultados: ResultadoTripBacktest[] = [];
    for (let i = 0; i < 5; i++) {
      resultados.push(
        makeResultado({
          tripId: `t-${i}`,
          ofertasV1: [{ empresaId: `loser-${i}`, vehicleId: 'v', scoreInt: 900 }],
          ofertasV2: [{ empresaId: `winner-${i}`, vehicleId: 'v', scoreInt: 950 }],
        }),
      );
    }
    const resumen = computeResumen(resultados);
    expect(resumen.empresasFavorecidas.length).toBe(3);
    expect(resumen.empresasPerjudicadas.length).toBe(3);
  });

  it('distribucionScoresV2: buckets correctos', () => {
    const resumen = computeResumen([
      makeResultado({
        ofertasV2: [
          { empresaId: 'e1', vehicleId: 'v', scoreInt: 100 }, // 0-200
          { empresaId: 'e2', vehicleId: 'v', scoreInt: 350 }, // 200-400
          { empresaId: 'e3', vehicleId: 'v', scoreInt: 550 }, // 400-600
          { empresaId: 'e4', vehicleId: 'v', scoreInt: 750 }, // 600-800
          { empresaId: 'e5', vehicleId: 'v', scoreInt: 950 }, // 800-1000
        ],
      }),
    ]);
    expect(resumen.distribucionScoresV2['0-200']).toBe(1);
    expect(resumen.distribucionScoresV2['200-400']).toBe(1);
    expect(resumen.distribucionScoresV2['400-600']).toBe(1);
    expect(resumen.distribucionScoresV2['600-800']).toBe(1);
    expect(resumen.distribucionScoresV2['800-1000']).toBe(1);
  });

  it('distribucionScoresV2: bucket edges — 200/400/600/800 caen al bucket superior', () => {
    const resumen = computeResumen([
      makeResultado({
        ofertasV2: [
          { empresaId: 'e1', vehicleId: 'v', scoreInt: 200 }, // borde → 200-400
          { empresaId: 'e2', vehicleId: 'v', scoreInt: 400 }, // borde → 400-600
          { empresaId: 'e3', vehicleId: 'v', scoreInt: 600 }, // borde → 600-800
          { empresaId: 'e4', vehicleId: 'v', scoreInt: 800 }, // borde → 800-1000
        ],
      }),
    ]);
    expect(resumen.distribucionScoresV2['200-400']).toBe(1);
    expect(resumen.distribucionScoresV2['400-600']).toBe(1);
    expect(resumen.distribucionScoresV2['600-800']).toBe(1);
    expect(resumen.distribucionScoresV2['800-1000']).toBe(1);
    expect(resumen.distribucionScoresV2['0-200']).toBe(0);
  });

  it('topNOverlapPct con denominador 0 (ningún trip con ofertas v2) → 0', () => {
    const resumen = computeResumen([makeResultado({ ofertasV2: [], overlapEmpresas: 0 })]);
    expect(resumen.topNOverlapPct).toBe(0);
  });

  it('mezcla compleja: validar shape completo del resumen', () => {
    const resumen = computeResumen([
      makeResultado({
        tripId: 't-1',
        deltaScorePromedio: 0.1,
        backhaulHit: true,
        ofertasV1: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 950 },
          { empresaId: 'emp-B', vehicleId: 'v2', scoreInt: 850 },
        ],
        ofertasV2: [
          { empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 970 },
          { empresaId: 'emp-C', vehicleId: 'v3', scoreInt: 880 },
        ],
        overlapEmpresas: 1,
      }),
      makeResultado({
        tripId: 't-2',
        deltaScorePromedio: -0.05,
        backhaulHit: false,
        ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
        ofertasV2: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 850 }],
        overlapEmpresas: 1,
      }),
    ]);
    expect(resumen.tripsProcesados).toBe(2);
    expect(resumen.backhaulHitRatePct).toBe(50);
    // V1: emp-A=2, emp-B=1. V2: emp-A=2, emp-C=1.
    // Deltas: emp-A=0 (skip), emp-B=-1 (loss), emp-C=+1 (gain).
    expect(resumen.empresasFavorecidas).toEqual([{ empresaId: 'emp-C', delta: 1 }]);
    expect(resumen.empresasPerjudicadas).toEqual([{ empresaId: 'emp-B', delta: -1 }]);
  });
});
