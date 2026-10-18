import {
  type ModalidadCarga,
  calcularLiquidacionV3,
  resolverComisionPct,
} from '@booster-ai/pricing-engine';
import type { ConfiguracionComercial } from '@booster-ai/shared-schemas';

/**
 * ADR-079 — piezas comerciales v3 del lado del generador: tasa que se
 * congela al publicar, si la modalidad está permitida, y el desglose que
 * solo ve el generador (§5: nunca se envía a transportista ni conductor).
 */

/** Tasa a congelar en una publicación nueva (una publicación no es retorno). */
export function tasaParaPublicacion(
  config: ConfiguracionComercial,
  modalidad: ModalidadCarga,
): number {
  return resolverComisionPct({
    modalidad,
    esRetorno: false,
    comisiones: {
      spotPct: config.comisiones.spot_pct,
      programadaPct: config.comisiones.programada_pct,
      retornoProgramadaPct: config.comisiones.retorno_programada_pct,
    },
  });
}

/** `programada` exige contrato programado habilitado por el platform-admin. */
export function modalidadPermitida(
  modalidad: ModalidadCarga,
  contratoProgramadoActivadoEn: Date | null,
): boolean {
  return modalidad === 'spot' || contratoProgramadoActivadoEn !== null;
}

/** Desglose para el generador. Claves en snake_case: es contrato de API. */
export interface DesgloseGenerador {
  precio_transportista_clp: number;
  comision_pct: number;
  comision_clp: number;
  iva_comision_clp: number;
  precio_generador_clp: number;
  total_factura_generador_clp: number;
}

export function desgloseParaGenerador(input: {
  precioTransportistaClp: number;
  /** Tasa congelada; `numeric` de Postgres llega como texto. */
  comisionPct: number | string;
  ivaPct: number;
}): DesgloseGenerador {
  const l = calcularLiquidacionV3({
    precioTransportistaClp: input.precioTransportistaClp,
    comisionPct: Number(input.comisionPct),
    ivaRate: input.ivaPct / 100,
  });
  return {
    precio_transportista_clp: l.precioTransportistaClp,
    comision_pct: l.comisionPct,
    comision_clp: l.comisionClp,
    iva_comision_clp: l.ivaComisionClp,
    precio_generador_clp: l.precioGeneradorClp,
    total_factura_generador_clp: l.totalFacturaGeneradorClp,
  };
}
