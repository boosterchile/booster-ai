import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS_V2,
  MATCHING_CONFIG,
  hashRanking,
  rankearCandidatos,
  scoreCandidate,
  scoreCandidateV2,
  scoreToInt,
  scoreToIntV2,
  selectTopNCandidates,
  selectTopNCandidatesV2,
} from '../src/index.js';

const v1 = (n: number, capacidad: number) => ({
  empresaId: `e${n}`,
  vehicleId: `v${n}`,
  vehicleCapacityKg: capacidad,
});

const v2 = (n: number, capacidad: number, backhaul = false) => ({
  ...v1(n, capacidad),
  tripActivoDestinoRegionMatch: backhaul,
  tripsRecientes: { totalUltimos7d: 0, matchRegionalUltimos7d: 0 },
  ofertasUltimos90d: { totales: 0, aceptadas: 0 },
  tierBoost: 0,
});

describe('rankearCandidatos v1', () => {
  it('equivale a scoreCandidate + selectTopNCandidates + scoreToInt (paridad con matching.ts)', () => {
    const candidatos = [v1(1, 30_000), v1(2, 10_000), v1(3, 12_000), v1(4, 50_000)];
    const esperado = selectTopNCandidates(
      candidatos.map((c) => ({ ...c, score: scoreCandidate(c, 9_000) })),
      2,
    );

    const r = rankearCandidatos({
      algoritmo: 'v1',
      cargoWeightKg: 9_000,
      maxOfertas: 2,
      candidatos,
    });

    expect(r.algoritmo).toBe('v1');
    expect(r.candidatosEvaluados).toBe(4);
    expect(r.top).toEqual(
      esperado.map((c) => ({
        empresaId: c.empresaId,
        vehicleId: c.vehicleId,
        vehicleCapacityKg: c.vehicleCapacityKg,
        score: c.score,
        scoreInt: scoreToInt(c.score),
      })),
    );
  });

  it('sin candidatos devuelve top vacío', () => {
    expect(
      rankearCandidatos({ algoritmo: 'v1', cargoWeightKg: 1, maxOfertas: 5, candidatos: [] }),
    ).toEqual({ algoritmo: 'v1', candidatosEvaluados: 0, top: [] });
  });
});

describe('rankearCandidatos v2', () => {
  it('equivale a scoreCandidateV2 + selectTopNCandidatesV2 + scoreToIntV2, con desglose', () => {
    const candidatos = [v2(1, 30_000), v2(2, 10_000, true), v2(3, 12_000)];
    const ctx = { cargoWeightKg: 9_000, originRegionCode: 'XIII' };
    const esperado = selectTopNCandidatesV2(
      candidatos.map((c) => scoreCandidateV2(c, ctx, DEFAULT_WEIGHTS_V2)),
      MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST,
    );

    const r = rankearCandidatos({
      algoritmo: 'v2',
      ...ctx,
      maxOfertas: MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST,
      pesos: DEFAULT_WEIGHTS_V2,
      candidatos,
    });

    expect(r.candidatosEvaluados).toBe(3);
    expect(r.top).toEqual(
      esperado.map((c) => ({
        empresaId: c.empresaId,
        vehicleId: c.vehicleId,
        vehicleCapacityKg: c.vehicleCapacityKg,
        score: c.score,
        scoreInt: scoreToIntV2(c.score),
        components: c.components,
        backhaulSignal: c.backhaulSignal,
      })),
    );
    expect(r.top[0]?.empresaId).toBe('e2');
  });

  it('pesos que no suman 1 lanzan (failsafe del algoritmo)', () => {
    expect(() =>
      rankearCandidatos({
        algoritmo: 'v2',
        cargoWeightKg: 1,
        originRegionCode: 'XIII',
        maxOfertas: 5,
        pesos: { capacidad: 1, backhaul: 1, reputacion: 0, tier: 0 },
        candidatos: [v2(1, 10)],
      }),
    ).toThrow();
  });
});

describe('hashRanking', () => {
  const top = [
    { empresaId: 'e1', vehicleId: 'v1', scoreInt: 900 },
    { empresaId: 'e2', vehicleId: 'v2', scoreInt: 850 },
  ];

  it('sha256 hex, sensible al orden, a la empresa, al vehículo y al score entero', () => {
    const h = hashRanking(top);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRanking([...top].reverse())).not.toBe(h);
    expect(
      hashRanking([{ ...top[0], empresaId: 'eX' } as (typeof top)[0], top[1] as (typeof top)[0]]),
    ).not.toBe(h);
    expect(
      hashRanking([{ ...top[0], vehicleId: 'vX' } as (typeof top)[0], top[1] as (typeof top)[0]]),
    ).not.toBe(h);
    expect(
      hashRanking([{ ...top[0], scoreInt: 901 } as (typeof top)[0], top[1] as (typeof top)[0]]),
    ).not.toBe(h);
  });

  it('ignora campos de desglose (solo la decisión persistida cuenta)', () => {
    expect(
      hashRanking(top.map((c) => ({ ...c, score: 0.9123, components: { capacidad: 1 } }))),
    ).toBe(hashRanking(top));
  });
});
