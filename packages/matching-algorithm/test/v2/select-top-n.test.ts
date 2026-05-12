import { describe, expect, it } from 'vitest';
import {
  type ScoredCandidateV2,
  scoreToIntV2,
  selectTopNCandidatesV2,
} from '../../src/v2/index.js';

/**
 * Tests del top-N selector (ADR-033 §7) — mismo contrato que v1 pero
 * tipado sobre `ScoredCandidateV2`. Verifica determinismo + tiebreaks.
 */

function buildScored(
  id: string,
  score: number,
  overrides: Partial<ScoredCandidateV2> = {},
): ScoredCandidateV2 {
  return {
    empresaId: `emp-${id}`,
    vehicleId: id,
    vehicleCapacityKg: 10_000,
    score,
    components: { capacidad: 0, backhaul: 0, reputacion: 0, tier: 0 },
    backhaulSignal: 'no_signal',
    ...overrides,
  };
}

describe('selectTopNCandidatesV2', () => {
  it('arreglo vacío → []', () => {
    expect(selectTopNCandidatesV2([], 5)).toEqual([]);
  });

  it('n=0 → []', () => {
    expect(selectTopNCandidatesV2([buildScored('a', 1)], 0)).toEqual([]);
  });

  it('n negativo → []', () => {
    expect(selectTopNCandidatesV2([buildScored('a', 1)], -3)).toEqual([]);
  });

  it('ordena descendente por score', () => {
    const r = selectTopNCandidatesV2(
      [buildScored('a', 0.5), buildScored('b', 0.9), buildScored('c', 0.7)],
      3,
    );
    expect(r.map((x) => x.vehicleId)).toEqual(['b', 'c', 'a']);
  });

  it('top-N corta correctamente', () => {
    const r = selectTopNCandidatesV2(
      [buildScored('a', 0.5), buildScored('b', 0.9), buildScored('c', 0.7), buildScored('d', 0.4)],
      2,
    );
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.vehicleId)).toEqual(['b', 'c']);
  });

  it('tiebreak por vehicleId asc cuando scores iguales', () => {
    const r = selectTopNCandidatesV2(
      [buildScored('zzz', 0.5), buildScored('aaa', 0.5), buildScored('mmm', 0.5)],
      3,
    );
    expect(r.map((x) => x.vehicleId)).toEqual(['aaa', 'mmm', 'zzz']);
  });

  it('mix de scores iguales + distintos respeta orden total', () => {
    const r = selectTopNCandidatesV2(
      [buildScored('a', 0.5), buildScored('c', 0.8), buildScored('b', 0.5), buildScored('d', 0.8)],
      4,
    );
    // 0.8: c, d (orden alfabético)
    // 0.5: a, b
    expect(r.map((x) => x.vehicleId)).toEqual(['c', 'd', 'a', 'b']);
  });

  it('no muta el array input', () => {
    const input = [buildScored('c', 0.3), buildScored('a', 0.9), buildScored('b', 0.6)];
    const originalOrder = input.map((x) => x.vehicleId);
    selectTopNCandidatesV2(input, 3);
    expect(input.map((x) => x.vehicleId)).toEqual(originalOrder);
  });

  it('n > length → devuelve todos ordenados', () => {
    const r = selectTopNCandidatesV2([buildScored('a', 0.5), buildScored('b', 0.7)], 10);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.vehicleId)).toEqual(['b', 'a']);
  });

  it('determinismo: 3 calls con mismo input → mismas salidas', () => {
    const input = [
      buildScored('a', 0.5),
      buildScored('b', 0.5),
      buildScored('c', 0.7),
      buildScored('d', 0.7),
    ];
    const r1 = selectTopNCandidatesV2(input, 3);
    const r2 = selectTopNCandidatesV2(input, 3);
    const r3 = selectTopNCandidatesV2(input, 3);
    expect(r1.map((x) => x.vehicleId)).toEqual(r2.map((x) => x.vehicleId));
    expect(r2.map((x) => x.vehicleId)).toEqual(r3.map((x) => x.vehicleId));
  });

  it('preserva todo el ScoredCandidateV2 (no solo el score)', () => {
    const input: ScoredCandidateV2[] = [
      buildScored('a', 0.8, {
        components: { capacidad: 0.9, backhaul: 1, reputacion: 0.5, tier: 0.3 },
        backhaulSignal: 'active_trip_match',
      }),
    ];
    const r = selectTopNCandidatesV2(input, 1);
    expect(r[0]?.components).toEqual({
      capacidad: 0.9,
      backhaul: 1,
      reputacion: 0.5,
      tier: 0.3,
    });
    expect(r[0]?.backhaulSignal).toBe('active_trip_match');
  });
});

describe('scoreToIntV2', () => {
  it('0 → 0', () => {
    expect(scoreToIntV2(0)).toBe(0);
  });

  it('1 → 1000', () => {
    expect(scoreToIntV2(1)).toBe(1000);
  });

  it('0.5 → 500', () => {
    expect(scoreToIntV2(0.5)).toBe(500);
  });

  it('0.725 → 725', () => {
    expect(scoreToIntV2(0.725)).toBe(725);
  });

  it('floating point edge case — round half', () => {
    // 0.0005 × 1000 = 0.5 → Math.round redondea a 1
    expect(scoreToIntV2(0.0005)).toBe(1);
  });

  it('score < 0 → throw', () => {
    expect(() => scoreToIntV2(-0.1)).toThrow(/fuera de \[0, 1\]/);
  });

  it('score > 1 → throw', () => {
    expect(() => scoreToIntV2(1.1)).toThrow(/fuera de \[0, 1\]/);
  });

  it('NaN → throw', () => {
    expect(() => scoreToIntV2(Number.NaN)).toThrow();
  });
});
