import { createHash } from 'node:crypto';
import {
  type ScoredCandidate,
  type VehicleCandidate,
  scoreCandidate,
  scoreToInt,
  selectTopNCandidates,
} from './index.js';
import {
  type CarrierCandidateV2,
  type ScoredCandidateV2,
  type WeightsV2,
  scoreCandidateV2,
  scoreToIntV2,
  selectTopNCandidatesV2,
} from './v2/index.js';

/**
 * Entrada del ranking de candidatos de un viaje (T10-21). El orquestador
 * (apps/api `runMatching`) carga los candidatos con sus queries y pide el
 * ranking; la misma función corre en el api (modo directo y fallback) y en
 * apps/matching-engine, así que hay una sola implementación del algoritmo.
 */
export type SolicitudRanking =
  | {
      algoritmo: 'v1';
      cargoWeightKg: number;
      maxOfertas: number;
      candidatos: readonly VehicleCandidate[];
    }
  | {
      algoritmo: 'v2';
      cargoWeightKg: number;
      originRegionCode: string;
      maxOfertas: number;
      pesos: WeightsV2;
      candidatos: readonly CarrierCandidateV2[];
    };

export interface CandidatoRankeado {
  empresaId: string;
  vehicleId: string;
  vehicleCapacityKg: number;
  /** Score ∈ [0, 1]. */
  score: number;
  /** Score ×1000 entero: lo que se persiste en `offers.score`. */
  scoreInt: number;
  /** Solo v2: desglose por componente (observabilidad, ADR-033 §10). */
  components?: ScoredCandidateV2['components'] | undefined;
  /** Solo v2: razón del componente backhaul. */
  backhaulSignal?: ScoredCandidateV2['backhaulSignal'] | undefined;
}

export interface ResultadoRanking {
  algoritmo: 'v1' | 'v2';
  candidatosEvaluados: number;
  /** Top-N en orden de oferta: score desc, desempate vehicleId asc. */
  top: CandidatoRankeado[];
}

/**
 * Scoring + top-N, determinista: misma solicitud → mismo resultado
 * bit a bit (requisito de auditoría y de la comparación en sombra).
 *
 * @throws Error si los pesos v2 no son válidos (failsafe de `scoreCandidateV2`).
 */
export function rankearCandidatos(solicitud: SolicitudRanking): ResultadoRanking {
  if (solicitud.algoritmo === 'v1') {
    const scored: ScoredCandidate[] = solicitud.candidatos.map((c) => ({
      empresaId: c.empresaId,
      vehicleId: c.vehicleId,
      vehicleCapacityKg: c.vehicleCapacityKg,
      score: scoreCandidate(c, solicitud.cargoWeightKg),
    }));
    return {
      algoritmo: 'v1',
      candidatosEvaluados: scored.length,
      top: selectTopNCandidates(scored, solicitud.maxOfertas).map((c) => ({
        empresaId: c.empresaId,
        vehicleId: c.vehicleId,
        vehicleCapacityKg: c.vehicleCapacityKg,
        score: c.score,
        scoreInt: scoreToInt(c.score),
      })),
    };
  }

  const contexto = {
    cargoWeightKg: solicitud.cargoWeightKg,
    originRegionCode: solicitud.originRegionCode,
  };
  const scored = solicitud.candidatos.map((c) => scoreCandidateV2(c, contexto, solicitud.pesos));
  return {
    algoritmo: 'v2',
    candidatosEvaluados: scored.length,
    top: selectTopNCandidatesV2(scored, solicitud.maxOfertas).map((c) => ({
      empresaId: c.empresaId,
      vehicleId: c.vehicleId,
      vehicleCapacityKg: c.vehicleCapacityKg,
      score: c.score,
      scoreInt: scoreToIntV2(c.score),
      components: c.components,
      backhaulSignal: c.backhaulSignal,
    })),
  };
}

/**
 * sha256 hex de la decisión persistida: (empresaId, vehicleId, scoreInt) en
 * orden. El desglose no entra: dos rankings con las mismas offers son el
 * mismo ranking. Lo usa la comparación en sombra api ↔ matching-engine.
 */
export function hashRanking(
  top: ReadonlyArray<Pick<CandidatoRankeado, 'empresaId' | 'vehicleId' | 'scoreInt'>>,
): string {
  return createHash('sha256')
    .update(JSON.stringify(top.map((c) => [c.empresaId, c.vehicleId, c.scoreInt])))
    .digest('hex');
}
