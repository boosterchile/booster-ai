/**
 * `computePricingSuggestion` — entrypoint público del package.
 *
 * Algoritmo baseline (v1):
 *
 * ```
 *   subtotal = baseFee
 *            + distanceKm × ratePerKm
 *            + weightKg × ratePerKg
 *            + max(volumeM3, weightKg/density) × ratePerM3
 *
 *   total    = subtotal × cargoTypeMultiplier
 *                       × urgencyMultiplier
 *                       × (oneWayEmpty ? 1.2 : 1.0)
 *                       , redondeado a múltiplo de 1000 CLP
 * ```
 *
 * Confidence:
 *   - `high` si volumen explícito + cargoType conocido (≠ otra)
 *   - `medium` si falta volumen O cargoType es 'otra' pero no ambos
 *   - `low` si faltan ambos
 *
 * Casos típicos calibrados:
 *   - Santiago → Concepción (530 km, 5000 kg, construccion, standard)
 *     → ~625K CLP
 *   - Misma ruta con urgencia express → ~780K CLP
 *   - Ruta corta urbana (50 km, 1000 kg, general, standard)
 *     → ~125K CLP
 */

import type { ZodError } from 'zod';
import { PricingValidationError } from './errors.js';
import {
  BASE_FEE_CLP,
  CARGO_TYPE_MULTIPLIERS,
  DEFAULT_DENSITY_KG_PER_M3,
  ONE_WAY_EMPTY_MULTIPLIER,
  type PricingConfig,
  RATE_PER_KG_CLP,
  RATE_PER_KM_CLP,
  RATE_PER_M3_CLP,
  URGENCY_MULTIPLIERS,
} from './multipliers.js';
import {
  type PricingBreakdown,
  type PricingInput,
  type PricingSuggestion,
  pricingInputSchema,
} from './types.js';

export function computePricingSuggestion(
  input: PricingInput,
  config: PricingConfig = {},
): PricingSuggestion {
  const parsed = pricingInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PricingValidationError(
      'Input inválido para computePricingSuggestion',
      flattenZodErrors(parsed.error),
    );
  }
  const data = parsed.data;

  // Tarifas (override-ables)
  const baseFee = config.baseFeeClp ?? BASE_FEE_CLP;
  const ratePerKm = config.ratePerKmClp ?? RATE_PER_KM_CLP;
  const ratePerKg = config.ratePerKgClp ?? RATE_PER_KG_CLP;
  const ratePerM3 = config.ratePerM3Clp ?? RATE_PER_M3_CLP;

  // Volumen efectivo: usa el dato explícito o lo deduce de peso/densidad.
  // El cargo de m³ se aplica sobre el max para que el carrier no se
  // salga regalando espacio cuando hay carga voluminosa pero liviana.
  const volumeFromWeight = data.weightKg / DEFAULT_DENSITY_KG_PER_M3;
  const effectiveVolumeM3 = data.volumeM3
    ? Math.max(data.volumeM3, volumeFromWeight)
    : volumeFromWeight;

  // Componentes base (antes de multipliers)
  const distanceClp = data.distanceKm * ratePerKm;
  const weightClp = data.weightKg * ratePerKg;
  const volumeClp = effectiveVolumeM3 * ratePerM3;
  const subtotalClp = baseFee + distanceClp + weightClp + volumeClp;

  // Multipliers
  const cargoMul =
    config.cargoMultipliers?.[data.cargoType] ?? CARGO_TYPE_MULTIPLIERS[data.cargoType];
  const urgencyMul = config.urgencyMultipliers?.[data.urgency] ?? URGENCY_MULTIPLIERS[data.urgency];
  const oneWayMul = data.isOneWayEmpty
    ? (config.oneWayEmptyMultiplier ?? ONE_WAY_EMPTY_MULTIPLIER)
    : 1.0;

  const totalRaw = subtotalClp * cargoMul * urgencyMul * oneWayMul;
  const totalClp = roundToThousand(totalRaw);

  const breakdown: PricingBreakdown = {
    baseFeeClp: baseFee,
    distanceClp: Math.round(distanceClp),
    weightClp: Math.round(weightClp),
    volumeClp: Math.round(volumeClp),
    multipliers: {
      cargoType: cargoMul,
      urgency: urgencyMul,
      oneWayEmpty: oneWayMul,
    },
    subtotalClp: Math.round(subtotalClp),
  };

  return {
    totalClp,
    breakdown,
    confidence: deriveConfidence(data),
  };
}

function deriveConfidence(data: PricingInput): PricingSuggestion['confidence'] {
  const hasVolume = data.volumeM3 !== undefined;
  const knownCargo = data.cargoType !== 'otra';
  if (hasVolume && knownCargo) {
    return 'high';
  }
  if (!hasVolume && !knownCargo) {
    return 'low';
  }
  return 'medium';
}

function roundToThousand(amount: number): number {
  return Math.round(amount / 1000) * 1000;
}

function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(issue.message);
  }
  return out;
}
