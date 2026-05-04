/**
 * @booster-ai/pricing-engine
 *
 * Motor de pricing baseline para sugerir precio de un trip al shipper
 * antes de publicarlo en el marketplace. Algoritmo: cargo fijo + km +
 * peso + volumen, todo modulado por multiplicadores de tipo de carga,
 * urgencia, y "one-way empty".
 *
 * **No** es el pricing definitivo — es una **sugerencia** que el shipper
 * puede ajustar manualmente. El campo `confidence` indica qué tan
 * fuerte es la sugerencia.
 *
 * @example
 * ```ts
 * import { computePricingSuggestion } from '@booster-ai/pricing-engine';
 *
 * const suggestion = computePricingSuggestion({
 *   distanceKm: 530,
 *   weightKg: 5000,
 *   cargoType: 'construccion',
 *   urgency: 'standard',
 *   volumeM3: 25,
 * });
 *
 * console.log(suggestion.totalClp);   // 625000
 * console.log(suggestion.confidence); // 'high'
 * ```
 *
 * Ver:
 * - HANDOFF.md §4 — bloqueante estructural "pricing-engine MVP"
 * - apps/api/src/services/matching.ts — usa el precio para emitir oferta
 */

export type {
  CargoType,
  Urgency,
  PricingInput,
  PricingSuggestion,
  PricingBreakdown,
} from './types.js';

export { cargoTypeSchema, urgencySchema, pricingInputSchema } from './types.js';

export {
  CARGO_TYPE_MULTIPLIERS,
  URGENCY_MULTIPLIERS,
  ONE_WAY_EMPTY_MULTIPLIER,
  BASE_FEE_CLP,
  RATE_PER_KM_CLP,
  RATE_PER_KG_CLP,
  RATE_PER_M3_CLP,
  DEFAULT_DENSITY_KG_PER_M3,
  type PricingConfig,
} from './multipliers.js';

export { PricingError, PricingValidationError } from './errors.js';

export { computePricingSuggestion } from './compute.js';
