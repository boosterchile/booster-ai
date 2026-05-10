import type { LiquidacionInput, LiquidacionOutput } from './types.js';

/**
 * Versión semver de la metodología de pricing. Cambios MINOR cuando
 * cambia tier table o IVA; MAJOR cuando cambia el modelo (uniform →
 * auction). Liquidaciones persistidas capturan esta versión en BD
 * y NO se re-emiten retroactivamente al subir.
 *
 * Ver ADR-030 §9.
 */
export const PRICING_METHODOLOGY_VERSION = 'pricing-v2.0-cl-2026.06' as const;

/** Tasa de IVA Chile (19%). Default cuando el caller no la sobrescribe. */
export const DEFAULT_IVA_RATE_CL = 0.19;

/**
 * Calcula la liquidación de un assignment dado el tier vigente del
 * carrier. Función PURA: sin I/O, sin Date.now(), determinista.
 *
 * Rounding: HALF_UP via `Math.round`. Todas las cantidades quedan en
 * CLP integer (Chile no usa centavos).
 *
 * @throws Error si `agreedPriceClp < 0` o `commissionPct < 0`. Inputs
 *   inválidos son bug del caller — no devolvemos "monto 0" silencioso.
 */
export function calcularLiquidacion(input: LiquidacionInput): LiquidacionOutput {
  const { agreedPriceClp, tier, ivaRate = DEFAULT_IVA_RATE_CL } = input;

  if (!Number.isFinite(agreedPriceClp) || agreedPriceClp < 0) {
    throw new Error(
      `calcularLiquidacion: agreedPriceClp debe ser número finito >= 0 (recibido ${agreedPriceClp})`,
    );
  }
  if (!Number.isFinite(tier.commissionPct) || tier.commissionPct < 0 || tier.commissionPct > 100) {
    throw new Error(
      `calcularLiquidacion: tier.commissionPct fuera de rango [0,100] (recibido ${tier.commissionPct})`,
    );
  }
  if (!Number.isFinite(ivaRate) || ivaRate < 0 || ivaRate > 1) {
    throw new Error(`calcularLiquidacion: ivaRate fuera de rango [0,1] (recibido ${ivaRate})`);
  }
  if (!Number.isInteger(agreedPriceClp)) {
    throw new Error(
      `calcularLiquidacion: agreedPriceClp debe ser integer (recibido ${agreedPriceClp})`,
    );
  }

  const montoBrutoClp = agreedPriceClp;
  const comisionClp = Math.round((montoBrutoClp * tier.commissionPct) / 100);
  const montoNetoCarrierClp = montoBrutoClp - comisionClp;
  const ivaComisionClp = Math.round(comisionClp * ivaRate);
  const totalFacturaBoosterClp = comisionClp + ivaComisionClp;

  return {
    montoBrutoClp,
    comisionPct: tier.commissionPct,
    comisionClp,
    montoNetoCarrierClp,
    ivaComisionClp,
    totalFacturaBoosterClp,
    tierAplicado: tier.slug,
    pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION,
  };
}
