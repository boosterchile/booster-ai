import type { Logger } from '@booster-ai/logger';
import {
  type CambiosGuardados,
  type TripRequestCreateInput,
  cargaEditadaPayloadSchema,
} from '@booster-ai/shared-schemas';
import { esEditablePreMatch, esEstadoViaje } from '@booster-ai/trip-state-machine';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { offers, tripEvents, trips } from '../db/schema.js';
import { leerComercialViaje } from './cambio-carga-comercial.js';
import { camposQueCambian, soloCampos, valoresActuales } from './cambio-carga-valores.js';
import { modalidadPermitida, tasaCongeladaParaModalidad } from './cotizacion-comercial.js';
import { type ValoresViaje, valoresViajeDesdeInput } from './valores-viaje.js';

/**
 * Edición total de una carga antes del match (editar-anular-cargas §6.1, §7).
 *
 *   - `borrador` / `esperando_match`: se actualiza la carga; el llamador corre
 *     el matching si queda en `esperando_match`.
 *   - `ofertas_enviadas` con algún campo material: las ofertas pendientes
 *     expiran y la carga vuelve a `esperando_match`, en la misma tx.
 *   - `ofertas_enviadas` con solo datos libres: las ofertas siguen vivas (el
 *     transportista ve el dato nuevo por el JOIN en vivo).
 *   - `emparejando`: 409 `trip_busy` (el matching está corriendo).
 *   - Después del match: 409 `trip_not_editable`; se usa una solicitud de cambio.
 *
 * El mismo origen o destino sin coordenadas conserva las del viaje; uno nuevo
 * sin coordenadas las deja en null (el llamador geocodifica el origen).
 */

export type ResultadoEditarCarga =
  | {
      ok: true;
      cambio: boolean;
      estado: string;
      ofertasInvalidadas: number;
      /** Cambió el origen y quedó sin coordenadas: geocodificar post-commit. */
      geocodificarOrigen: { originAddress: string; destinationAddress: string } | null;
    }
  | { ok: false; code: 'trip_not_found' }
  | { ok: false; code: 'trip_busy' }
  | { ok: false; code: 'trip_not_editable'; currentStatus: string }
  | { ok: false; code: 'contrato_programado_no_habilitado' };

type ViajeRow = typeof trips.$inferSelect;

/** Conserva las coordenadas actuales si el extremo no cambió de dirección. */
function heredarCoordenadas(valores: ValoresViaje, viaje: ViajeRow): ValoresViaje {
  const v = { ...valores };
  const mismoOrigen =
    v.originAddressRaw === viaje.originAddressRaw &&
    v.originRegionCode === viaje.originRegionCode &&
    v.originComunaCode === viaje.originComunaCode;
  if (mismoOrigen && v.originLatitude === null) {
    v.originLatitude = viaje.originLatitude;
    v.originLongitude = viaje.originLongitude;
  }
  const mismoDestino =
    v.destinationAddressRaw === viaje.destinationAddressRaw &&
    v.destinationRegionCode === viaje.destinationRegionCode &&
    v.destinationComunaCode === viaje.destinationComunaCode;
  if (mismoDestino && v.destinationLatitude === null) {
    v.destinationLatitude = viaje.destinationLatitude;
    v.destinationLongitude = viaje.destinationLongitude;
  }
  return v;
}

/** Los valores del formulario en la forma de `cambiosGuardadosSchema`. */
function proyeccion(v: ValoresViaje): Required<CambiosGuardados> {
  return valoresActuales({
    originAddressRaw: v.originAddressRaw,
    originRegionCode: v.originRegionCode ?? null,
    originComunaCode: v.originComunaCode ?? null,
    originLatitude: v.originLatitude ?? null,
    originLongitude: v.originLongitude ?? null,
    destinationAddressRaw: v.destinationAddressRaw,
    destinationRegionCode: v.destinationRegionCode ?? null,
    destinationComunaCode: v.destinationComunaCode ?? null,
    destinationLatitude: v.destinationLatitude ?? null,
    destinationLongitude: v.destinationLongitude ?? null,
    cargoType: v.cargoType,
    cargoWeightKg: v.cargoWeightKg ?? null,
    cargoVolumeM3: v.cargoVolumeM3 ?? null,
    cargoDescription: v.cargoDescription ?? null,
    pickupWindowStart: v.pickupWindowStart ?? null,
    pickupWindowEnd: v.pickupWindowEnd ?? null,
    proposedPriceClp: v.proposedPriceClp ?? null,
    modalidadCarga: v.modalidadCarga ?? 'spot',
  });
}

function libresQueCambian(
  v: ValoresViaje,
  viaje: ViajeRow,
): Array<'consignee' | 'notes' | 'reference'> {
  const out: Array<'consignee' | 'notes' | 'reference'> = [];
  if (
    v.consigneeName !== viaje.consigneeName ||
    v.consigneeEmail !== viaje.consigneeEmail ||
    v.consigneeWhatsappE164 !== viaje.consigneeWhatsappE164
  ) {
    out.push('consignee');
  }
  if (v.notes !== viaje.notes) {
    out.push('notes');
  }
  if (v.reference !== viaje.reference) {
    out.push('reference');
  }
  return out;
}

export async function editarCargaPreMatch(
  deps: { db: Db; logger: Logger },
  opts: {
    tripId: string;
    empresaId: string;
    userId: string;
    input: TripRequestCreateInput;
    contratoProgramadoActivadoEn: Date | null;
  },
): Promise<ResultadoEditarCarga> {
  const { db, logger } = deps;
  const { tripId, empresaId, userId, input } = opts;
  return await db.transaction(async (tx) => {
    const [viaje] = await tx
      .select()
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
      .for('update')
      .limit(1);
    if (!viaje) {
      return { ok: false, code: 'trip_not_found' } as const;
    }
    const estado = viaje.status;
    if (estado === 'emparejando') {
      return { ok: false, code: 'trip_busy' } as const;
    }
    if (!esEstadoViaje(estado) || !esEditablePreMatch(estado)) {
      return { ok: false, code: 'trip_not_editable', currentStatus: estado } as const;
    }
    if (!modalidadPermitida(input.modalidad_carga, opts.contratoProgramadoActivadoEn)) {
      return { ok: false, code: 'contrato_programado_no_habilitado' } as const;
    }

    const valores = heredarCoordenadas(valoresViajeDesdeInput(input), viaje);
    // Las dos proyecciones parten de numeric(10,7) en texto: comparan igual.
    const antes = valoresActuales(viaje);
    const despues = proyeccion(valores);
    const materiales = camposQueCambian(antes, despues);
    const libres = libresQueCambian(valores, viaje);
    if (materiales.length === 0 && libres.length === 0) {
      return {
        ok: true,
        cambio: false,
        estado,
        ofertasInvalidadas: 0,
        geocodificarOrigen: null,
      } as const;
    }

    // §7: un cambio de modalidad cambia de tasa dentro de la versión congelada.
    let comision: { antes: string | null; despues: string | null } | null = null;
    if (materiales.includes('modalidad_carga') && viaje.comisionPctAplicada) {
      const comercial = await leerComercialViaje(tx, tripId);
      if (comercial.configCongelada) {
        const nueva = tasaCongeladaParaModalidad(
          comercial.configCongelada,
          input.modalidad_carga,
        ).toFixed(2);
        comision = { antes: viaje.comisionPctAplicada, despues: nueva };
      }
    }

    const now = new Date();
    await tx
      .update(trips)
      .set({
        ...valores,
        ...(comision ? { comisionPctAplicada: comision.despues } : {}),
        updatedAt: now,
      })
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)));

    let invalidadas = 0;
    let estadoFinal = estado;
    if (materiales.length > 0 && estado === 'ofertas_enviadas') {
      // rls-allowlist: ofertas del viaje bloqueado arriba y validado contra la empresa generadora (empresaId).
      const expiradas = await tx
        .update(offers)
        .set({ status: 'expirada', updatedAt: now })
        .where(and(eq(offers.tripId, tripId), eq(offers.status, 'pendiente')))
        .returning({ id: offers.id });
      invalidadas = expiradas.length;
      const vuelta = await tx
        .update(trips)
        .set({ status: 'esperando_match', updatedAt: now })
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.generadorCargaEmpresaId, empresaId),
            eq(trips.status, 'ofertas_enviadas'),
          ),
        )
        .returning({ id: trips.id });
      if (vuelta.length === 0) {
        throw new Error(`la carga ${tripId} dejó de estar en ofertas_enviadas bajo lock`);
      }
      estadoFinal = 'esperando_match';
    }

    await tx.insert(tripEvents).values({
      tripId,
      eventType: 'carga_editada',
      source: 'web',
      recordedByUserId: userId,
      payload: cargaEditadaPayloadSchema.parse({
        modo: 'pre_match',
        campos: [...materiales, ...libres],
        antes: soloCampos(antes, materiales),
        despues: soloCampos(despues, materiales),
        ...(invalidadas > 0 ? { invalidated_offers: invalidadas } : {}),
        ...(comision
          ? {
              comercial: {
                comision_pct_antes: comision.antes,
                comision_pct_despues: comision.despues,
              },
            }
          : {}),
      }),
    });
    logger.info(
      { tripId, materiales, libres, invalidadas, estado: estadoFinal },
      'carga editada antes del match',
    );
    return {
      ok: true,
      cambio: true,
      estado: estadoFinal,
      ofertasInvalidadas: invalidadas,
      geocodificarOrigen:
        materiales.includes('origin') && valores.originLatitude === null
          ? {
              originAddress: valores.originAddressRaw,
              destinationAddress: valores.destinationAddressRaw,
            }
          : null,
    } as const;
  });
}
