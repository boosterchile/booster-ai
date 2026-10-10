import { DEFAULT_IVA_RATE_CL } from './liquidacion.js';

/**
 * Metodología de pricing v3 (ADR-079 §6). MAJOR respecto de v2: cambian el
 * pagador (el generador, no el transportista) y la base (la comisión se suma
 * al precio del transportista en vez de descontarse). Toda liquidación v3
 * persiste esta versión y el `configuracion_comercial_id` usado.
 */
export const PRICING_METHODOLOGY_VERSION_V3 = 'pricing-v3.0-cl-2026.09' as const;

/** Modalidad comercial de la carga (ADR-079 §2; columna `modalidad_carga`). */
export type ModalidadCarga = 'spot' | 'programada';

export interface ComisionesV3 {
  spotPct: number;
  programadaPct: number;
  /** Opcional: tasa del retorno programado marcado por el matching. */
  retornoProgramadaPct?: number | undefined;
}

/**
 * Tasa que corresponde a una publicación (ADR-079 §2):
 *   - spot → `spotPct` (un retorno spot paga la tasa spot);
 *   - programada → `programadaPct`, salvo retorno marcado con tasa de
 *     retorno configurada → `retornoProgramadaPct`.
 * Las invariantes entre tasas las valida `configuracionComercialSchema`.
 */
export function resolverComisionPct(input: {
  modalidad: ModalidadCarga;
  esRetorno: boolean;
  comisiones: ComisionesV3;
}): number {
  const { modalidad, esRetorno, comisiones } = input;
  if (modalidad === 'spot') {
    return comisiones.spotPct;
  }
  if (esRetorno && comisiones.retornoProgramadaPct !== undefined) {
    return comisiones.retornoProgramadaPct;
  }
  return comisiones.programadaPct;
}

export interface LiquidacionV3Input {
  /** Lo que recibe el transportista, íntegro. Ancla de todo el cálculo. */
  precioTransportistaClp: number;
  /** Tasa congelada al publicar (`viajes.comision_pct_aplicada`), 0–100. */
  comisionPct: number;
  /** IVA sobre la comisión (default 19 %). */
  ivaRate?: number;
}

export interface LiquidacionV3Output {
  precioTransportistaClp: number;
  comisionPct: number;
  comisionClp: number;
  ivaComisionClp: number;
  /** `precioTransportistaClp + comisionClp`: lo que paga el generador por el flete con servicio. */
  precioGeneradorClp: number;
  /** `comisionClp + ivaComisionClp`: la factura de Booster al generador. */
  totalFacturaGeneradorClp: number;
  pricingMethodologyVersion: typeof PRICING_METHODOLOGY_VERSION_V3;
}

/**
 * Liquidación v3 (ADR-079 §1): el generador paga la comisión encima del
 * precio del transportista. Función PURA, determinista, HALF_UP a CLP entero.
 *
 * @throws Error ante entradas inválidas: es un bug del caller, nunca un
 *   monto silencioso.
 */
export function calcularLiquidacionV3(input: LiquidacionV3Input): LiquidacionV3Output {
  const { precioTransportistaClp, comisionPct, ivaRate = DEFAULT_IVA_RATE_CL } = input;

  if (
    !Number.isFinite(precioTransportistaClp) ||
    precioTransportistaClp < 0 ||
    !Number.isInteger(precioTransportistaClp)
  ) {
    throw new Error(
      `calcularLiquidacionV3: precioTransportistaClp debe ser entero >= 0 (recibido ${precioTransportistaClp})`,
    );
  }
  if (!Number.isFinite(comisionPct) || comisionPct < 0 || comisionPct > 100) {
    throw new Error(
      `calcularLiquidacionV3: comisionPct fuera de rango [0,100] (recibido ${comisionPct})`,
    );
  }
  if (!Number.isFinite(ivaRate) || ivaRate < 0 || ivaRate > 1) {
    throw new Error(`calcularLiquidacionV3: ivaRate fuera de rango [0,1] (recibido ${ivaRate})`);
  }

  const comisionClp = Math.round((precioTransportistaClp * comisionPct) / 100);
  const ivaComisionClp = Math.round(comisionClp * ivaRate);

  return {
    precioTransportistaClp,
    comisionPct,
    comisionClp,
    ivaComisionClp,
    precioGeneradorClp: precioTransportistaClp + comisionClp,
    totalFacturaGeneradorClp: comisionClp + ivaComisionClp,
    pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
  };
}
