import {
  type ModalidadCarga,
  calcularLiquidacionV3,
  calcularLiquidacionV4,
  resolverComisionPct,
} from '@booster-ai/pricing-engine';
import type { ConfiguracionComercial } from '@booster-ai/shared-schemas';

/**
 * Piezas comerciales del lado del generador: tasa que se congela al publicar
 * y si la modalidad está permitida (ADR-079 §2), y lo que el generador ve
 * (nunca se envía a transportista ni conductor). En publicación y cotización
 * rige ADR-094: el precio es el del viaje y el generador ve lo que paga con
 * IVA. El desglose de ADR-079 §1 queda solo para los cambios de carga, hasta
 * el frente 4 de `.specs/comision-dentro-del-precio`.
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

/**
 * Tasa de comisión para una modalidad, tomada de la versión de configuración
 * congelada al publicar (`viajes.configuracion_comercial_id`), nunca de la
 * vigente (editar-anular-cargas §7): un cambio de modalidad cambia de tasa
 * dentro de la misma versión, y una configuración publicada después no se
 * cuela. Es la misma regla de publicación, aplicada a la versión congelada.
 */
export function tasaCongeladaParaModalidad(
  configCongelada: ConfiguracionComercial,
  modalidad: ModalidadCarga,
): number {
  return tasaParaPublicacion(configCongelada, modalidad);
}

/** `programada` exige contrato programado habilitado por el platform-admin. */
export function modalidadPermitida(
  modalidad: ModalidadCarga,
  contratoProgramadoActivadoEn: Date | null,
): boolean {
  return modalidad === 'spot' || contratoProgramadoActivadoEn !== null;
}

/**
 * ADR-094 §1 y §3 — lo que el generador ve de un viaje: su precio neto, el
 * IVA y el total que paga. No lleva la comisión ni lo que recibe el
 * transportista. Claves en snake_case: es contrato de API.
 */
export interface DesgloseViajeGenerador {
  precio_viaje_clp: number;
  iva_viaje_clp: number;
  total_generador_clp: number;
}

export function desgloseViajeParaGenerador(input: {
  precioViajeClp: number;
  /** Tasa congelada; `numeric` de Postgres llega como texto. */
  comisionPct: number | string;
  ivaPct: number;
}): DesgloseViajeGenerador {
  const l = calcularLiquidacionV4({
    precioViajeClp: input.precioViajeClp,
    comisionPct: Number(input.comisionPct),
    ivaRate: input.ivaPct / 100,
  });
  return {
    precio_viaje_clp: l.precioViajeClp,
    iva_viaje_clp: l.ivaViajeClp,
    total_generador_clp: l.totalGeneradorClp,
  };
}

/**
 * Desglose de ADR-079 §1 (comisión encima del precio del transportista).
 * Lo usa solo la propuesta de cambio de carga; ADR-094 lo deja sin efecto y
 * el frente 4 lo retira. Claves en snake_case: es contrato de API.
 */
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
