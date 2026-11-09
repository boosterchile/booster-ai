import type { ModalidadCarga } from '@booster-ai/pricing-engine';
import {
  type CambiosGuardados,
  type ConfiguracionComercial,
  configuracionComercialSchema,
} from '@booster-ai/shared-schemas';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { configuracionComercial, empresas, trips } from '../db/schema.js';
import {
  type DesgloseGenerador,
  desgloseParaGenerador,
  modalidadPermitida,
  tasaCongeladaParaModalidad,
} from './cotizacion-comercial.js';

/**
 * Precio y modalidad en una solicitud de cambio (editar-anular-cargas §7,
 * ADR-079). La tasa sale de la versión de configuración congelada al publicar;
 * un viaje publicado sin tasa congelada (v2 o v3 apagado) solo cambia la
 * modalidad. El desglose del generador nunca se envía al transportista ni al
 * conductor (ADR-079 §5).
 */

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface ComercialViaje {
  proposedPriceClp: number | null;
  modalidadCarga: ModalidadCarga;
  /** `numeric(5,2)` como texto, o null si el viaje no congeló tasa. */
  comisionPctAplicada: string | null;
  /** La versión apuntada por `viajes.configuracion_comercial_id`, parseada. */
  configCongelada: ConfiguracionComercial | null;
  /** De la empresa generadora: `programada` lo exige (ADR-079 §2). */
  contratoProgramadoActivadoEn: Date | null;
}

/** Lee lo comercial del viaje: tasa, versión congelada y contrato del generador. */
export async function leerComercialViaje(db: Db | Tx, tripId: string): Promise<ComercialViaje> {
  // rls-allowlist: el llamador ya validó el viaje contra su empresa (generadora o transportista).
  const [fila] = await db
    .select({
      proposedPriceClp: trips.proposedPriceClp,
      modalidadCarga: trips.modalidadCarga,
      comisionPctAplicada: trips.comisionPctAplicada,
      config: configuracionComercial.config,
      contratoProgramadoActivadoEn: empresas.contratoProgramadoActivadoEn,
    })
    .from(trips)
    .leftJoin(configuracionComercial, eq(configuracionComercial.id, trips.configuracionComercialId))
    .leftJoin(empresas, eq(empresas.id, trips.generadorCargaEmpresaId))
    .where(eq(trips.id, tripId))
    .limit(1);
  if (!fila) {
    throw new Error(`viaje ${tripId} no encontrado al leer su configuración comercial`);
  }
  return {
    proposedPriceClp: fila.proposedPriceClp,
    modalidadCarga: fila.modalidadCarga,
    comisionPctAplicada: fila.comisionPctAplicada,
    configCongelada: fila.config ? configuracionComercialSchema.parse(fila.config) : null,
    contratoProgramadoActivadoEn: fila.contratoProgramadoActivadoEn ?? null,
  };
}

function tieneTasaCongelada(
  c: ComercialViaje,
): c is ComercialViaje & { comisionPctAplicada: string; configCongelada: ConfiguracionComercial } {
  return c.comisionPctAplicada !== null && c.configCongelada !== null;
}

export type ResultadoRecalculo =
  | {
      ok: true;
      viaje: { comisionPctAplicada?: string };
      asignacion: { agreedPriceClp?: number };
      bloque: {
        precio_acordado_antes: number;
        precio_acordado_despues: number;
        comision_pct_antes: string | null;
        comision_pct_despues: string | null;
      };
    }
  | { ok: false; code: 'contrato_programado_no_habilitado' };

/**
 * Qué escribir al aceptar un cambio comercial. Precio: `viajes` (lo escribe
 * `columnasDesdeCambios`) y `asignaciones.precio_acordado_clp`, que lee la
 * liquidación. Modalidad: la tasa de la versión congelada, con `toFixed(2)`
 * como al publicar.
 */
export function recalculoComercial(
  c: ComercialViaje,
  cambios: CambiosGuardados,
  precioAcordadoActual: number,
): ResultadoRecalculo {
  if (
    cambios.modalidad_carga !== undefined &&
    !modalidadPermitida(cambios.modalidad_carga, c.contratoProgramadoActivadoEn)
  ) {
    return { ok: false, code: 'contrato_programado_no_habilitado' };
  }
  const viaje: { comisionPctAplicada?: string } = {};
  let comisionDespues = c.comisionPctAplicada;
  if (cambios.modalidad_carga !== undefined && tieneTasaCongelada(c)) {
    comisionDespues = tasaCongeladaParaModalidad(
      c.configCongelada,
      cambios.modalidad_carga,
    ).toFixed(2);
    viaje.comisionPctAplicada = comisionDespues;
  }
  const asignacion: { agreedPriceClp?: number } = {};
  const precioNuevo =
    typeof cambios.proposed_price_clp === 'number' ? cambios.proposed_price_clp : null;
  if (precioNuevo !== null) {
    asignacion.agreedPriceClp = precioNuevo;
  }
  return {
    ok: true,
    viaje,
    asignacion,
    bloque: {
      precio_acordado_antes: precioAcordadoActual,
      precio_acordado_despues: precioNuevo ?? precioAcordadoActual,
      comision_pct_antes: c.comisionPctAplicada,
      comision_pct_despues: comisionDespues,
    },
  };
}

/**
 * Desglose de la propuesta para el generador: precio, comisión e IVA con la
 * tasa congelada para la modalidad propuesta. Null si el cambio no es
 * comercial o el viaje no congeló tasa.
 */
export function desglosePropuesto(
  c: ComercialViaje,
  cambios: CambiosGuardados,
): DesgloseGenerador | null {
  const comercial =
    cambios.proposed_price_clp !== undefined || cambios.modalidad_carga !== undefined;
  if (!comercial || !tieneTasaCongelada(c)) {
    return null;
  }
  const precio = cambios.proposed_price_clp ?? c.proposedPriceClp;
  if (precio === null || precio === undefined) {
    return null;
  }
  const tasa =
    cambios.modalidad_carga !== undefined
      ? tasaCongeladaParaModalidad(c.configCongelada, cambios.modalidad_carga)
      : Number(c.comisionPctAplicada);
  return desgloseParaGenerador({
    precioTransportistaClp: precio,
    comisionPct: tasa,
    ivaPct: c.configCongelada.impuestos.iva_pct,
  });
}
