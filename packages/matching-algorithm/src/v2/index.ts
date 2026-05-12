/**
 * @booster-ai/matching-algorithm/v2 — multi-factor scoring con
 * awareness de empty-backhaul (ADR-033).
 *
 * Función pura, sin DB. El orquestador
 * (`apps/api/src/services/matching-v2.ts`) hace los lookups SQL para
 * llenar `CarrierCandidateV2` y luego invoca `scoreCandidateV2`.
 *
 * Backwards-compatible con v1: ambos coexisten. El flag
 * `MATCHING_ALGORITHM_V2_ACTIVATED` decide cuál usar en runtime.
 */

export { scoreCandidateV2 } from './score-candidate.js';

export {
  selectTopNCandidatesV2,
  scoreToIntV2,
} from './select-top-n.js';

export type {
  CarrierCandidateV2,
  TripScoringContextV2,
  WeightsV2,
  ScoredCandidateV2,
  TierSlug,
} from './types.js';

export {
  DEFAULT_WEIGHTS_V2,
  DEFAULT_TIER_BOOSTS,
  SCORING_PARAMS_V2,
  tierBoostFromSlug,
  validateWeights,
} from './types.js';
