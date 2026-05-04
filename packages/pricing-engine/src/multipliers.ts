/**
 * Tablas de multiplicadores del motor de pricing.
 *
 * Estos números son **baseline** calibrado con observaciones de mercado
 * Chile 2026 (transporte de carga regional). En el futuro deberían venir
 * de una tabla en BD que el equipo comercial pueda ajustar sin re-deploy
 * — pero por ahora hardcoded para velocidad de iteración.
 *
 * El equipo comercial puede override-ear via `PricingConfig.overrideMultipliers`.
 */

import type { CargoType, Urgency } from './types.js';

/**
 * Multiplicador por tipo de carga. 1.0 = baseline (carga general).
 *   - peligrosa: 1.5x (seguro + manejo especial)
 *   - frigorifica/frio: 1.4x (cadena de frío)
 *   - ganado: 1.4x (bienestar animal + paradas)
 *   - liquidos: 1.3x (cisterna especializada)
 *   - graneles: 1.1x (volumen alto, mismo manejo)
 *   - construccion/agricola: 1.0x (carga estándar)
 *   - general: 1.0x (baseline)
 *   - otra: 1.2x (incertidumbre)
 */
export const CARGO_TYPE_MULTIPLIERS: Record<CargoType, number> = {
  general: 1.0,
  frigorifica: 1.4,
  peligrosa: 1.5,
  frio: 1.4,
  liquidos: 1.3,
  graneles: 1.1,
  construccion: 1.0,
  agricola: 1.0,
  ganado: 1.4,
  otra: 1.2,
};

/**
 * Multiplicador por urgencia.
 *   - flexible: 0.9x (10% descuento por flexibilidad de fecha)
 *   - standard: 1.0x (baseline)
 *   - express: 1.25x (mismo día / siguiente)
 *   - critical: 1.6x (<6h emergencia)
 */
export const URGENCY_MULTIPLIERS: Record<Urgency, number> = {
  flexible: 0.9,
  standard: 1.0,
  express: 1.25,
  critical: 1.6,
};

/**
 * Penalidad por viaje sin retorno (one-way empty). Aplicar como
 * multiplicador al subtotal — refleja que el carrier carga el costo
 * del km de retorno vacío.
 */
export const ONE_WAY_EMPTY_MULTIPLIER = 1.2;

/**
 * Tarifas base.
 */
export const BASE_FEE_CLP = 50_000;
/** CLP por km. */
export const RATE_PER_KM_CLP = 850;
/** CLP por kg. */
export const RATE_PER_KG_CLP = 12;
/** CLP por m³. */
export const RATE_PER_M3_CLP = 8_500;

/**
 * Densidad de referencia para deducir volumen desde peso si el caller
 * no lo provee (200 kg/m³ es razonable para carga general no apilada).
 */
export const DEFAULT_DENSITY_KG_PER_M3 = 200;

/**
 * Permite override de los defaults por feature flag o config remoto.
 */
export interface PricingConfig {
  baseFeeClp?: number;
  ratePerKmClp?: number;
  ratePerKgClp?: number;
  ratePerM3Clp?: number;
  cargoMultipliers?: Partial<Record<CargoType, number>>;
  urgencyMultipliers?: Partial<Record<Urgency, number>>;
  oneWayEmptyMultiplier?: number;
}
