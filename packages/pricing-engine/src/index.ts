/**
 * @booster-ai/pricing-engine
 *
 * Foundation técnica de pricing v2 (ADR-030).
 *
 * Funciones puras (sin I/O):
 *   - `calcularLiquidacion(input)`: comisión + IVA + neto para un trip
 *     dado el tier vigente del carrier.
 *   - `calcularCobroMembership(input)`: factura mensual de membresía
 *     según el tier (Free skip).
 *   - `periodoMesDesde(date)`: helper para construir slug `YYYY-MM` en
 *     zona Chile.
 *   - `decidirSiguienteDunning(input)`: máquina de estados de reintentos
 *     de cobro de membresía (hasta 3 reintentos, ADR-031).
 *
 * Tipos:
 *   - `TierSlug`, `MembershipTier`, `SEED_MEMBERSHIP_TIERS` (los 4
 *     tiers de ADR-026 hardcoded para tests/simulator).
 *   - `LiquidacionInput/Output`, `CobroMembershipInput/Output`.
 *
 * Constantes:
 *   - `PRICING_METHODOLOGY_VERSION`: semver capturada en cada
 *     liquidación persistida.
 *   - `DEFAULT_IVA_RATE_CL`: 0.19 (Chile).
 */

export {
  calcularLiquidacion,
  DEFAULT_IVA_RATE_CL,
  PRICING_METHODOLOGY_VERSION,
} from './liquidacion.js';
export { calcularCobroMembership, periodoMesDesde } from './cobro-membership.js';
export {
  DUNNING_BACKOFF_DIAS,
  DUNNING_MAX_INTENTOS,
  decidirSiguienteDunning,
  type CobroEstadoDunning,
  type DecidirDunningInput,
  type DecidirDunningOutput,
  type ResultadoGatewayPago,
} from './dunning-membership.js';
export {
  SEED_MEMBERSHIP_TIERS,
  TIER_SLUGS,
  type CobroMembershipFactura,
  type CobroMembershipInput,
  type CobroMembershipOutput,
  type LiquidacionInput,
  type LiquidacionOutput,
  type MembershipTier,
  type TierSlug,
} from './types.js';
