import { describe, expect, it } from 'vitest';
import { respuestaRankingSchema, solicitudRankingSchema } from './matching-ranking.js';

const E = '00000000-0000-4000-8000-0000000000e1';
const V = '00000000-0000-4000-8000-0000000000a1';

const v1 = {
  algoritmo: 'v1',
  cargoWeightKg: 9000,
  maxOfertas: 5,
  candidatos: [{ empresaId: E, vehicleId: V, vehicleCapacityKg: 10000 }],
} as const;

const v2 = {
  algoritmo: 'v2',
  cargoWeightKg: 9000,
  originRegionCode: 'XIII',
  maxOfertas: 5,
  pesos: { capacidad: 0.4, backhaul: 0.35, reputacion: 0.15, tier: 0.1 },
  candidatos: [
    {
      empresaId: E,
      vehicleId: V,
      vehicleCapacityKg: 10000,
      tripActivoDestinoRegionMatch: true,
      tripsRecientes: { totalUltimos7d: 3, matchRegionalUltimos7d: 1 },
      ofertasUltimos90d: { totales: 10, aceptadas: 4 },
      tierBoost: 0.5,
    },
  ],
} as const;

describe('solicitudRankingSchema', () => {
  it('acepta v1 y v2 bien formadas', () => {
    expect(solicitudRankingSchema.parse(v1)).toEqual(v1);
    expect(solicitudRankingSchema.parse(v2)).toEqual(v2);
  });

  it('v2 exige pesos y región; v1 no los acepta como v2', () => {
    const { pesos: _p, ...sinPesos } = v2;
    expect(solicitudRankingSchema.safeParse(sinPesos).success).toBe(false);
    expect(solicitudRankingSchema.safeParse({ ...v1, algoritmo: 'v3' }).success).toBe(false);
  });

  it('rechaza ids no uuid, capacidad no positiva, maxOfertas fuera de rango y listas enormes', () => {
    const c = v1.candidatos[0];
    expect(
      solicitudRankingSchema.safeParse({ ...v1, candidatos: [{ ...c, empresaId: 'x' }] }).success,
    ).toBe(false);
    expect(
      solicitudRankingSchema.safeParse({ ...v1, candidatos: [{ ...c, vehicleCapacityKg: 0 }] })
        .success,
    ).toBe(false);
    expect(solicitudRankingSchema.safeParse({ ...v1, maxOfertas: 0 }).success).toBe(false);
    expect(
      solicitudRankingSchema.safeParse({ ...v1, candidatos: Array.from({ length: 1001 }, () => c) })
        .success,
    ).toBe(false);
  });
});

describe('respuestaRankingSchema', () => {
  it('acepta un ranking con y sin desglose', () => {
    const r = {
      algoritmo: 'v2',
      candidatosEvaluados: 1,
      top: [
        {
          empresaId: E,
          vehicleId: V,
          vehicleCapacityKg: 10000,
          score: 0.9,
          scoreInt: 900,
          components: { capacidad: 1, backhaul: 1, reputacion: 0.4, tier: 0.5 },
          backhaulSignal: 'active_trip_match',
        },
      ],
    };
    expect(respuestaRankingSchema.parse(r)).toEqual(r);
    expect(
      respuestaRankingSchema.safeParse({
        algoritmo: 'v1',
        candidatosEvaluados: 0,
        top: [],
      }).success,
    ).toBe(true);
  });

  it('rechaza scoreInt fuera de 0..1000', () => {
    expect(
      respuestaRankingSchema.safeParse({
        algoritmo: 'v1',
        candidatosEvaluados: 1,
        top: [{ empresaId: E, vehicleId: V, vehicleCapacityKg: 1, score: 1, scoreInt: 1001 }],
      }).success,
    ).toBe(false);
  });
});
