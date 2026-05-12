import {
  type CarrierCandidateV2,
  DEFAULT_WEIGHTS_V2,
  SCORING_PARAMS_V2,
  type ScoredCandidateV2,
  type TripScoringContextV2,
  type WeightsV2,
  validateWeights,
} from './types.js';

/**
 * Algoritmo de matching v2 — scoring multi-factor con awareness de
 * empty-backhaul (ADR-033).
 *
 * Combina 4 componentes ∈ [0, 1]:
 *   - `capacidad`  (best-fit, peso 0.40)
 *   - `backhaul`   (presencia geo reciente, peso 0.35) **NUEVO**
 *   - `reputacion` (tasa de aceptación 90d, peso 0.15)
 *   - `tier`       (priority boost de membresía, peso 0.10)
 *
 * Función **pura**: sin DB, sin fetch, sin side effects. Determinística.
 * Mismo input → mismo output.
 *
 * Diseño defensivo:
 *   - Si `weights` no suma 1.0, lanza Error (failsafe contra config bug).
 *   - Si `cargoWeightKg <= 0`, `s_capacidad = 1.0` (no se puede penalizar
 *     algo que no se sabe).
 *   - Si carrier sin historial, `s_reputacion = 0.5` (floor neutro,
 *     onboarding-friendly).
 *   - Capa cada componente a [0, 1] antes de agregar.
 *
 * @throws Error si `weights` no suma ≈ 1.0 o algún peso está fuera de [0,1].
 */
export function scoreCandidateV2(
  candidate: CarrierCandidateV2,
  trip: TripScoringContextV2,
  weights: WeightsV2 = DEFAULT_WEIGHTS_V2,
): ScoredCandidateV2 {
  validateWeights(weights);

  const sCapacidad = computeCapacidad(candidate, trip);
  const { score: sBackhaul, signal: backhaulSignal } = computeBackhaul(candidate);
  const sReputacion = computeReputacion(candidate);
  const sTier = computeTier(candidate);

  const score =
    weights.capacidad * sCapacidad +
    weights.backhaul * sBackhaul +
    weights.reputacion * sReputacion +
    weights.tier * sTier;

  return {
    empresaId: candidate.empresaId,
    vehicleId: candidate.vehicleId,
    vehicleCapacityKg: candidate.vehicleCapacityKg,
    // Cap defensivo a [0, 1] — si los pesos pasan el invariante pero
    // hay floating point drift, el score final queda acotado.
    score: clamp01(score),
    components: {
      capacidad: sCapacidad,
      backhaul: sBackhaul,
      reputacion: sReputacion,
      tier: sTier,
    },
    backhaulSignal,
  };
}

/**
 * Componente capacidad — mismo modelo v1 pero penalty endurecido a 0.5
 * (ADR-033 §2).
 *
 *   slackRatio  = (capacity − cargo) / capacity
 *   s_capacidad = max(0, 1 − slackRatio × 0.5)
 *
 * Si `cargoWeightKg ≤ 0` → 1.0 (no se penaliza información ausente).
 */
function computeCapacidad(candidate: CarrierCandidateV2, trip: TripScoringContextV2): number {
  if (trip.cargoWeightKg <= 0) {
    return 1;
  }
  if (candidate.vehicleCapacityKg <= 0) {
    // Vehículo con capacidad 0 o negativa no debería llegar acá (filtrado
    // SQL-side por `capacity_kg > 0`), pero defensivo: score 0.
    return 0;
  }
  const slackRatio =
    (candidate.vehicleCapacityKg - trip.cargoWeightKg) / candidate.vehicleCapacityKg;
  // Si la carga supera la capacidad (slackRatio < 0), eso ya debería estar
  // filtrado SQL-side. Si llega acá, capamos a 0 (no calificable).
  if (slackRatio < 0) {
    return 0;
  }
  return clamp01(1 - slackRatio * SCORING_PARAMS_V2.CAPACITY_SLACK_PENALTY);
}

/**
 * Componente backhaul — señal nueva (ADR-033 §3).
 *
 * Tres ramas en orden de prioridad:
 *   1. `tripActivoDestinoRegionMatch = true` → 1.0 (match perfecto)
 *   2. histórico 7d con `matchRegional/total > 0` → fracción
 *   3. sin señal → 0
 *
 * Retorna también el `signal` para observabilidad (logging del
 * orchestrator).
 */
function computeBackhaul(candidate: CarrierCandidateV2): {
  score: number;
  signal: ScoredCandidateV2['backhaulSignal'];
} {
  if (candidate.tripActivoDestinoRegionMatch) {
    return { score: 1, signal: 'active_trip_match' };
  }
  const { totalUltimos7d, matchRegionalUltimos7d } = candidate.tripsRecientes;
  if (totalUltimos7d > 0 && matchRegionalUltimos7d > 0) {
    const fraction = matchRegionalUltimos7d / totalUltimos7d;
    return {
      score: clamp01(fraction),
      signal: 'recent_history_match',
    };
  }
  return { score: 0, signal: 'no_signal' };
}

/**
 * Componente reputación — tasa de aceptación últimos 90d (ADR-033 §4).
 *
 * Si carrier tiene <`N_MIN_OFFERS_FOR_REPUTATION` ofertas → floor neutro
 * de `REPUTATION_FLOOR_NEW_CARRIER` (0.5). Esto evita penalizar
 * carriers nuevos por sparsity.
 *
 * Para los demás: `aceptadas / totales` capado a [0, 1].
 */
function computeReputacion(candidate: CarrierCandidateV2): number {
  const { totales, aceptadas } = candidate.ofertasUltimos90d;
  if (totales < SCORING_PARAMS_V2.N_MIN_OFFERS_FOR_REPUTATION) {
    return SCORING_PARAMS_V2.REPUTATION_FLOOR_NEW_CARRIER;
  }
  if (totales <= 0) {
    return SCORING_PARAMS_V2.REPUTATION_FLOOR_NEW_CARRIER;
  }
  return clamp01(aceptadas / totales);
}

/**
 * Componente tier — priority boost del tier de membresía (ADR-033 §5).
 *
 * El orchestrator hace el lookup en `carrier_memberships` y pasa el
 * valor `tierBoost` ya resuelto. Acá solo aplicamos el clamp.
 */
function computeTier(candidate: CarrierCandidateV2): number {
  return clamp01(candidate.tierBoost);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
