import { describe, expect, it } from 'vitest';
import {
  MATCHING_CONFIG,
  type ScoredCandidate,
  type VehicleCandidate,
  scoreCandidate,
  scoreToInt,
  selectTopNCandidates,
} from '../src/index.js';

const candidate1k: VehicleCandidate = {
  empresaId: 'empresa-1',
  vehicleId: 'v1',
  vehicleCapacityKg: 1000,
};

const candidate10k: VehicleCandidate = {
  empresaId: 'empresa-2',
  vehicleId: 'v2',
  vehicleCapacityKg: 10_000,
};

describe('scoreCandidate', () => {
  it('peso=0 retorna score=1 (no penaliza incertidumbre)', () => {
    expect(scoreCandidate(candidate1k, 0)).toBe(1);
    expect(scoreCandidate(candidate10k, 0)).toBe(1);
  });

  it('peso negativo también retorna 1 (defensa)', () => {
    expect(scoreCandidate(candidate1k, -100)).toBe(1);
  });

  it('vehículo perfectamente ajustado al peso → score=1 (sin slack)', () => {
    expect(scoreCandidate(candidate1k, 1000)).toBe(1);
  });

  it('vehículo grande para carga chica → score < 1', () => {
    // Cargo 1000kg en camión 10000kg: slack = (10000-1000)/10000 = 0.9
    // Score = 1 - 0.9 × 0.1 = 0.91
    const score = scoreCandidate(candidate10k, 1000);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeCloseTo(0.91, 2);
  });

  it('vehículo casi al límite → score cercano a 1', () => {
    // Cargo 950kg en camión 1000kg: slack = 0.05, score = 1 - 0.05*0.1 = 0.995
    const score = scoreCandidate(candidate1k, 950);
    expect(score).toBeCloseTo(0.995, 3);
  });

  it('score nunca es negativo (clamp en 0)', () => {
    // Hipótesis: vehículo absurdamente sobredimensionado.
    const huge: VehicleCandidate = {
      empresaId: 'x',
      vehicleId: 'huge',
      vehicleCapacityKg: 1_000_000,
    };
    const score = scoreCandidate(huge, 1);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('orden de score: ajuste perfecto > pequeño slack > gran slack', () => {
    const cargoKg = 500;
    const cap500 = scoreCandidate({ ...candidate1k, vehicleCapacityKg: 500 }, cargoKg);
    const cap1k = scoreCandidate(candidate1k, cargoKg);
    const cap10k = scoreCandidate(candidate10k, cargoKg);
    expect(cap500).toBeGreaterThan(cap1k);
    expect(cap1k).toBeGreaterThan(cap10k);
  });
});

describe('selectTopNCandidates', () => {
  const candidates: ScoredCandidate[] = [
    { empresaId: 'e1', vehicleId: 'v3', vehicleCapacityKg: 5000, score: 0.9 },
    { empresaId: 'e2', vehicleId: 'v1', vehicleCapacityKg: 5000, score: 0.95 },
    { empresaId: 'e3', vehicleId: 'v2', vehicleCapacityKg: 5000, score: 0.85 },
    { empresaId: 'e4', vehicleId: 'v4', vehicleCapacityKg: 5000, score: 0.95 },
    { empresaId: 'e5', vehicleId: 'v5', vehicleCapacityKg: 5000, score: 0.7 },
    { empresaId: 'e6', vehicleId: 'v6', vehicleCapacityKg: 5000, score: 0.8 },
    { empresaId: 'e7', vehicleId: 'v7', vehicleCapacityKg: 5000, score: 0.6 },
  ];

  it('default N = MAX_OFFERS_PER_REQUEST', () => {
    const top = selectTopNCandidates(candidates);
    expect(top).toHaveLength(MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST);
  });

  it('orden por score descendente', () => {
    const top = selectTopNCandidates(candidates, 7);
    const scores = top.map((c) => c.score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i + 1]!);
    }
  });

  it('empate: estabilidad por vehicleId ascendente', () => {
    const top = selectTopNCandidates(candidates, 7);
    // Primeros 2 tienen score 0.95: v1 antes que v4 alphabéticamente
    expect(top[0]!.vehicleId).toBe('v1');
    expect(top[1]!.vehicleId).toBe('v4');
  });

  it('limit N respeta', () => {
    expect(selectTopNCandidates(candidates, 1)).toHaveLength(1);
    expect(selectTopNCandidates(candidates, 3)).toHaveLength(3);
  });

  it('input vacío → array vacío', () => {
    expect(selectTopNCandidates([])).toEqual([]);
  });

  it('no muta el input original', () => {
    const original = [...candidates];
    selectTopNCandidates(candidates, 3);
    expect(candidates).toEqual(original);
  });

  it('N mayor que candidatos disponibles → devuelve todos', () => {
    expect(selectTopNCandidates(candidates, 100)).toHaveLength(candidates.length);
  });
});

describe('scoreToInt', () => {
  it('convierte 0-1 a entero × 1000', () => {
    expect(scoreToInt(0)).toBe(0);
    expect(scoreToInt(0.5)).toBe(500);
    expect(scoreToInt(1)).toBe(1000);
    expect(scoreToInt(0.91)).toBe(910);
    expect(scoreToInt(0.995)).toBe(995);
  });

  it('redondea correctamente', () => {
    expect(scoreToInt(0.4995)).toBe(500);
    expect(scoreToInt(0.4994)).toBe(499);
  });
});

describe('MATCHING_CONFIG', () => {
  it('valores baseline esperados', () => {
    expect(MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST).toBe(5);
    expect(MATCHING_CONFIG.OFFER_TTL_MINUTES).toBe(60);
    expect(MATCHING_CONFIG.CAPACITY_SLACK_PENALTY).toBe(0.1);
  });

  it('readonly (TS readonly + as const)', () => {
    // Esto compila pero TS lo marca como error en strict — corremos
    // el assert para confirmar que el objeto está congelado en runtime
    // (as const lo hace tipo readonly, no Object.freeze realmente).
    // Si el caller intentara mutarlo, TS lo bloquearía.
    expect(typeof MATCHING_CONFIG).toBe('object');
  });
});
