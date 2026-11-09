import type { Logger } from '@booster-ai/logger';
import { type DatosLibresInput, cargaEditadaPayloadSchema } from '@booster-ai/shared-schemas';
import { aceptaDatosLibres, esEstadoViaje } from '@booster-ai/trip-state-machine';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripEvents, trips } from '../db/schema.js';

/**
 * Edición de los datos libres de una carga (spec editar-anular-cargas §6.2):
 * destinatario, notas y referencia. Se editan sin aceptación del transportista
 * en todo estado no terminal (`aceptaDatosLibres`).
 *
 * Una sola transacción con lock del viaje: lee, compara, escribe solo lo que
 * cambió y registra `carga_editada {modo:'libre', campos}` sin valores (el
 * destinatario y las notas pueden tener datos personales y eventos_viaje es
 * append-only). Las notificaciones las despacha el llamador después del commit
 * con lo que devuelve esta función.
 */

type CampoLibre = 'consignee' | 'notes' | 'reference';

/** Estados de la asignación en que el transportista y el conductor siguen activos. */
const ASIGNACION_ACTIVA = ['asignado', 'recogido'] as const;

export type ResultadoDatosLibres =
  | {
      ok: true;
      campos: CampoLibre[];
      /** Teléfono del destinatario si cambió a un valor no nulo (para reenviar el link). */
      telefonoDestinatarioNuevo: string | null;
      /** Asignación activa, para avisar al transportista y al conductor. */
      asignacion: {
        id: string;
        status: string;
        empresaId: string;
        driverUserId: string | null;
      } | null;
    }
  | { ok: false; code: 'trip_not_found' }
  | { ok: false; code: 'trip_not_editable'; currentStatus: string }
  | { ok: false; code: 'sin_cambios' };

export async function editarDatosLibres(
  deps: { db: Db; logger: Logger },
  opts: { tripId: string; empresaId: string; userId: string; input: DatosLibresInput },
): Promise<ResultadoDatosLibres> {
  const { db, logger } = deps;
  const { tripId, empresaId, userId, input } = opts;

  return await db.transaction(async (tx) => {
    const [viaje] = await tx
      .select({
        status: trips.status,
        consigneeName: trips.consigneeName,
        consigneeWhatsappE164: trips.consigneeWhatsappE164,
        consigneeEmail: trips.consigneeEmail,
        notes: trips.notes,
        reference: trips.reference,
      })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
      .for('update')
      .limit(1);
    if (!viaje) {
      return { ok: false, code: 'trip_not_found' } as const;
    }
    if (!esEstadoViaje(viaje.status) || !aceptaDatosLibres(viaje.status)) {
      return { ok: false, code: 'trip_not_editable', currentStatus: viaje.status } as const;
    }

    const cambios: Partial<typeof trips.$inferInsert> = {};
    const campos: CampoLibre[] = [];
    if (input.consignee !== undefined) {
      // El destinatario se reemplaza completo; null lo borra.
      const nuevo = {
        consigneeName: input.consignee?.name ?? null,
        consigneeWhatsappE164: input.consignee?.phone_e164 ?? null,
        consigneeEmail: input.consignee?.email ?? null,
      };
      if (
        nuevo.consigneeName !== viaje.consigneeName ||
        nuevo.consigneeWhatsappE164 !== viaje.consigneeWhatsappE164 ||
        nuevo.consigneeEmail !== viaje.consigneeEmail
      ) {
        Object.assign(cambios, nuevo);
        campos.push('consignee');
      }
    }
    if (input.notes !== undefined && input.notes !== viaje.notes) {
      cambios.notes = input.notes;
      campos.push('notes');
    }
    if (input.reference !== undefined && input.reference !== viaje.reference) {
      cambios.reference = input.reference;
      campos.push('reference');
    }
    if (campos.length === 0) {
      return { ok: false, code: 'sin_cambios' } as const;
    }

    await tx
      .update(trips)
      .set({ ...cambios, updatedAt: new Date() })
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)));
    await tx.insert(tripEvents).values({
      tripId,
      eventType: 'carga_editada',
      source: 'web',
      recordedByUserId: userId,
      payload: cargaEditadaPayloadSchema.parse({ modo: 'libre', campos }),
    });

    const telefonoNuevo =
      cambios.consigneeWhatsappE164 !== undefined &&
      cambios.consigneeWhatsappE164 !== null &&
      cambios.consigneeWhatsappE164 !== viaje.consigneeWhatsappE164
        ? cambios.consigneeWhatsappE164
        : null;

    // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
    const [asignacion] = await tx
      .select({
        id: assignments.id,
        status: assignments.status,
        empresaId: assignments.empresaId,
        driverUserId: assignments.driverUserId,
      })
      .from(assignments)
      .where(and(eq(assignments.tripId, tripId), inArray(assignments.status, ASIGNACION_ACTIVA)))
      .limit(1);

    logger.info(
      { tripId, campos, conAsignacion: Boolean(asignacion) },
      'datos libres de la carga editados',
    );
    return {
      ok: true,
      campos,
      telefonoDestinatarioNuevo: telefonoNuevo,
      asignacion: asignacion ?? null,
    } as const;
  });
}
