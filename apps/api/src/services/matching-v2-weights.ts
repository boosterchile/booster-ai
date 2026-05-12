import type { Logger } from '@booster-ai/logger';
import {
  DEFAULT_WEIGHTS_V2,
  type WeightsV2,
  validateWeights,
} from '@booster-ai/matching-algorithm';
import { z } from 'zod';
import { config as appConfig } from '../config.js';

/**
 * Parser defensivo de `MATCHING_V2_WEIGHTS_JSON` (ADR-033 §1).
 *
 * Si la env var está vacía o malformada, retorna `DEFAULT_WEIGHTS_V2`
 * con un log WARN — preferimos fallback a defaults conocidos antes
 * que crashear el matching.
 *
 * Casos cubiertos:
 *   - Empty string → defaults sin warn.
 *   - JSON inválido → warn + defaults.
 *   - JSON con shape correcto pero suma ≠ 1.0 → warn + defaults.
 *   - JSON con shape incorrecto → warn + defaults.
 */
const weightsSchema = z.object({
  capacidad: z.number().min(0).max(1),
  backhaul: z.number().min(0).max(1),
  reputacion: z.number().min(0).max(1),
  tier: z.number().min(0).max(1),
});

export function resolveMatchingV2Weights(logger: Logger): WeightsV2 {
  const raw = appConfig.MATCHING_V2_WEIGHTS_JSON?.trim();
  if (!raw) {
    return DEFAULT_WEIGHTS_V2;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err, raw },
      'MATCHING_V2_WEIGHTS_JSON: JSON inválido — usando DEFAULT_WEIGHTS_V2',
    );
    return DEFAULT_WEIGHTS_V2;
  }

  const parsed = weightsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    logger.warn(
      { errors: parsed.error.format() },
      'MATCHING_V2_WEIGHTS_JSON: shape inválido — usando DEFAULT_WEIGHTS_V2',
    );
    return DEFAULT_WEIGHTS_V2;
  }

  try {
    validateWeights(parsed.data);
  } catch (err) {
    logger.warn(
      { err, weights: parsed.data },
      'MATCHING_V2_WEIGHTS_JSON: validación falló — usando DEFAULT_WEIGHTS_V2',
    );
    return DEFAULT_WEIGHTS_V2;
  }

  return parsed.data;
}
