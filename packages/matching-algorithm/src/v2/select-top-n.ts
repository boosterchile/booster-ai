import type { ScoredCandidateV2 } from './types.js';

/**
 * Selección top-N con tiebreaks deterministas (ADR-033 §7).
 *
 * Mismo contrato que `selectTopNCandidates` de v1:
 *   1. ordenar por `score` desc
 *   2. tiebreak por `vehicleId.localeCompare` asc (string ASCII estable)
 *   3. slice(0, n)
 *
 * **Determinismo**: dada la misma entrada, la salida es bit-idéntica.
 * Es requisito para audit + reproducibilidad GLEC.
 *
 * **No muta el input**: clona antes de ordenar.
 */
export function selectTopNCandidatesV2(
  candidates: ScoredCandidateV2[],
  n: number,
): ScoredCandidateV2[] {
  if (n <= 0) {
    return [];
  }
  return [...candidates]
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.vehicleId.localeCompare(b.vehicleId);
    })
    .slice(0, n);
}

/**
 * Convierte un score 0..1 a entero 0..1000 para persistir en
 * `offers.score` (integer column, sin floats). Mismo helper que v1.
 *
 * @throws Error si `score` está fuera de [0, 1] (defensa contra bug
 * upstream que invente scores inválidos).
 */
export function scoreToIntV2(score: number): number {
  if (Number.isNaN(score) || score < 0 || score > 1) {
    throw new Error(`scoreToIntV2: score=${score} fuera de [0, 1]`);
  }
  return Math.round(score * 1000);
}
