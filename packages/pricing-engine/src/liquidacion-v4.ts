import { DEFAULT_IVA_RATE_CL } from './liquidacion.js';

/**
 * Metodología de pricing v4 (ADR-094). MAJOR respecto de v3: cambia el ancla
 * (el precio del viaje que paga el generador, no el del transportista) y la
 * base (la comisión se descuenta dentro de ese precio en vez de sumarse).
 */
export const PRICING_METHODOLOGY_VERSION_V4 = 'pricing-v4.0-cl-2026.11' as const;

export interface LiquidacionV4Input {
  /** Precio neto del viaje: lo que paga el generador antes de IVA. Ancla del cálculo. */
  precioViajeClp: number;
  /** Tasa congelada al publicar (`viajes.comision_pct_aplicada`), 0–100. */
  comisionPct: number;
  /** IVA del flete y de la comisión (default 19 %). */
  ivaRate?: number;
}

export interface LiquidacionV4Output {
  precioViajeClp: number;
  ivaViajeClp: number;
  /** `precioViajeClp + ivaViajeClp`: lo que paga el generador. */
  totalGeneradorClp: number;
  comisionPct: number;
  comisionClp: number;
  ivaComisionClp: number;
  /** `comisionClp + ivaComisionClp`: la factura de Booster al generador. */
  totalFacturaBoosterClp: number;
  /** `precioViajeClp - comisionClp`: el neto que el transportista factura al generador. Es lo único que él ve. */
  precioTransportistaClp: number;
  /** `totalGeneradorClp - totalFacturaBoosterClp`: la factura del transportista al generador, con IVA. */
  totalTransportistaClp: number;
  pricingMethodologyVersion: typeof PRICING_METHODOLOGY_VERSION_V4;
}

/**
 * Liquidación v4 (ADR-094 §1): el generador paga el precio del viaje con IVA,
 * repartido en dos facturas: la de Booster por su comisión y la del
 * transportista por el resto. Función PURA, determinista, HALF_UP a CLP entero.
 *
 * Invariante: `totalGeneradorClp === totalTransportistaClp + totalFacturaBoosterClp`.
 *
 * @throws Error ante entradas inválidas: es un bug del caller, nunca un
 *   monto silencioso.
 */
export function calcularLiquidacionV4(input: LiquidacionV4Input): LiquidacionV4Output {
  const { precioViajeClp, comisionPct, ivaRate = DEFAULT_IVA_RATE_CL } = input;

  if (!Number.isFinite(precioViajeClp) || precioViajeClp < 0 || !Number.isInteger(precioViajeClp)) {
    throw new Error(
      `calcularLiquidacionV4: precioViajeClp debe ser entero >= 0 (recibido ${precioViajeClp})`,
    );
  }
  if (!Number.isFinite(comisionPct) || comisionPct < 0 || comisionPct > 100) {
    throw new Error(
      `calcularLiquidacionV4: comisionPct fuera de rango [0,100] (recibido ${comisionPct})`,
    );
  }
  if (!Number.isFinite(ivaRate) || ivaRate < 0 || ivaRate > 1) {
    throw new Error(`calcularLiquidacionV4: ivaRate fuera de rango [0,1] (recibido ${ivaRate})`);
  }

  const ivaViajeClp = Math.round(precioViajeClp * ivaRate);
  const comisionClp = Math.round((precioViajeClp * comisionPct) / 100);
  const ivaComisionClp = Math.round(comisionClp * ivaRate);
  const totalGeneradorClp = precioViajeClp + ivaViajeClp;
  const totalFacturaBoosterClp = comisionClp + ivaComisionClp;

  return {
    precioViajeClp,
    ivaViajeClp,
    totalGeneradorClp,
    comisionPct,
    comisionClp,
    ivaComisionClp,
    totalFacturaBoosterClp,
    precioTransportistaClp: precioViajeClp - comisionClp,
    totalTransportistaClp: totalGeneradorClp - totalFacturaBoosterClp,
    pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V4,
  };
}
