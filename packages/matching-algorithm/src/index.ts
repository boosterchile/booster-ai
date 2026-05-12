/**
 * @booster-ai/matching-algorithm
 *
 * Lógica pura de matching engine. Sin dependencias de DB ni servicios —
 * el orquestador (apps/api/src/services/matching.ts) hace las queries y
 * usa estos helpers para evaluar/seleccionar candidatos.
 *
 * Slice B.5 — algoritmo simple sin geo precisa:
 *   1. Filtro de zona (origen contenido en zona pickup del transportista).
 *   2. Filtro de capacidad (vehículo con capacity_kg ≥ peso de carga).
 *   3. Score = 1 - slack_capacidad * penalty (vehículo más ajustado al
 *      peso = mayor score, evita desperdiciar camión grande con carga
 *      chica).
 *   4. Top N por score.
 *
 * Slices posteriores (B.6+):
 *   - Geo precisa por comuna + radio km.
 *   - Ratings históricos, on-time delivery rate.
 *   - Cargo type compatibility (refrigerado va sólo a refrigerado).
 *   - Pricing dinámico vs proposed_price_clp del generador de carga.
 */

/**
 * Configuración del matching MVP. Valores conservadores para piloto;
 * tunear con datos reales post-launch.
 */
export const MATCHING_CONFIG = {
  /** Cuántas offers paralelas crear máximo por trip. */
  MAX_OFFERS_PER_REQUEST: 5,
  /** Cuánto vive una offer pending antes de expirar (minutos). */
  OFFER_TTL_MINUTES: 60,
  /** Descuento de score por slack de capacidad (vehículo grande para carga chica). */
  CAPACITY_SLACK_PENALTY: 0.1,
} as const;

export interface VehicleCandidate {
  empresaId: string;
  vehicleId: string;
  vehicleCapacityKg: number;
}

export interface ScoredCandidate extends VehicleCandidate {
  score: number;
}

/**
 * Calcula el score (0-1) de un candidato en función de su slack de
 * capacidad respecto al peso de la carga. Más slack = vehículo más
 * sobredimensionado = score más bajo.
 *
 * Si cargoWeightKg=0 (no declarado), retorna score=1 — no podemos
 * penalizar por algo que no sabemos.
 */
export function scoreCandidate(candidate: VehicleCandidate, cargoWeightKg: number): number {
  if (cargoWeightKg <= 0) {
    return 1;
  }
  const slackRatio = (candidate.vehicleCapacityKg - cargoWeightKg) / candidate.vehicleCapacityKg;
  return Math.max(0, 1 - slackRatio * MATCHING_CONFIG.CAPACITY_SLACK_PENALTY);
}

/**
 * Selecciona los top N candidatos por score descendente. Empate:
 * estabilidad por orden original (vehicleId asc).
 */
export function selectTopNCandidates(
  candidates: ScoredCandidate[],
  n: number = MATCHING_CONFIG.MAX_OFFERS_PER_REQUEST,
): ScoredCandidate[] {
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
 * Convierte un score 0-1 a entero ×1000 para persistir en DB sin floats.
 */
export function scoreToInt(score: number): number {
  return Math.round(score * 1000);
}

/**
 * Razones por las que un trip no encuentra candidatos. Usado para
 * registrar `oferta_expirada` con contexto.
 */
export type NoCandidatesReason =
  | 'no_carrier_in_origin_region'
  | 'no_active_carriers'
  | 'no_vehicle_with_capacity';

/**
 * Factor de matching de retorno (input para empty backhaul allocation
 * GLEC v3.0 §6.4). Función pura usada por
 * `apps/api/src/services/calcular-metricas-viaje.ts`.
 */
export {
  MATCHING_TIME_WINDOW_HORAS,
  type ParametrosFactorMatching,
  type PrecisionFactorMatching,
  type ResultadoFactorMatching,
  calcularFactorMatching,
} from './factor-matching.js';

/**
 * Matching algorithm v2 — multi-factor con awareness de empty-backhaul
 * (ADR-033). Coexiste con v1 detrás de feature flag
 * `MATCHING_ALGORITHM_V2_ACTIVATED`.
 *
 * Acceso desde el orquestador:
 *   import { scoreCandidateV2 } from '@booster-ai/matching-algorithm';
 * o equivalente con namespace:
 *   import { v2 } from '@booster-ai/matching-algorithm';
 */
export {
  DEFAULT_TIER_BOOSTS,
  DEFAULT_WEIGHTS_V2,
  SCORING_PARAMS_V2,
  scoreCandidateV2,
  scoreToIntV2,
  selectTopNCandidatesV2,
  tierBoostFromSlug,
  validateWeights,
} from './v2/index.js';
export type {
  CarrierCandidateV2,
  ScoredCandidateV2,
  TierSlug,
  TripScoringContextV2,
  WeightsV2,
} from './v2/index.js';
