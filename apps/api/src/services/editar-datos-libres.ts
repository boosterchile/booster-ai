import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { type DatosLibresInput, cargaEditadaPayloadSchema } from '@booster-ai/shared-schemas';
import { aceptaDatosLibres, esEstadoViaje } from '@booster-ai/trip-state-machine';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conductorDeAsignacion } from '../db/configuracion-de-asignacion.js';
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
 *
 * Enlace público de seguimiento (`.specs/seguimiento-enlace-destinatario/`
 * §3.1): si el destinatario tenía un contacto y ese contacto cambia o se quita,
 * el token de la asignación activa se reemplaza en la misma transacción. El
 * token no sale de esta función: el reenvío lo lee de la asignación.
 */

type CampoLibre = 'consignee' | 'notes' | 'reference';

/** Estados de la asignación en que el transportista y el conductor siguen activos. */
const ASIGNACION_ACTIVA = ['asignado', 'recogido'] as const;

export type ResultadoDatosLibres =
  | {
      ok: true;
      campos: CampoLibre[];
      /** El enlace público de seguimiento se reemplazó: el anterior ya no responde. */
      enlaceRenovado: boolean;
      /**
       * A qué contactos del destinatario hay que mandar el enlace vigente. Con el
       * enlace reemplazado, los contactos que quedaron; sin reemplazar, solo los
       * que cambiaron a un valor.
       */
      reenviarEnlace: { telefono: string | null; correo: string | null };
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

/** Mismo correo sin distinguir mayúsculas; null solo es igual a null. */
function mismoCorreo(a: string | null, b: string | null): boolean {
  return a === null || b === null ? a === b : a.toLowerCase() === b.toLowerCase();
}

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
    let contactoAnteriorCambio = false;
    const reenviarEnlace: { telefono: string | null; correo: string | null } = {
      telefono: null,
      correo: null,
    };
    let contactoVigente = reenviarEnlace;
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
        const telefonoCambio = nuevo.consigneeWhatsappE164 !== viaje.consigneeWhatsappE164;
        const correoCambio = !mismoCorreo(nuevo.consigneeEmail, viaje.consigneeEmail);
        contactoAnteriorCambio =
          (viaje.consigneeWhatsappE164 !== null && telefonoCambio) ||
          (viaje.consigneeEmail !== null && correoCambio);
        contactoVigente = {
          telefono: nuevo.consigneeWhatsappE164,
          correo: nuevo.consigneeEmail,
        };
        reenviarEnlace.telefono = telefonoCambio ? nuevo.consigneeWhatsappE164 : null;
        reenviarEnlace.correo = correoCambio ? nuevo.consigneeEmail : null;
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

    // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
    const [fila] = await tx
      .select({
        id: assignments.id,
        status: assignments.status,
        empresaId: assignments.empresaId,
        driverUserId: conductorDeAsignacion,
        publicTrackingToken: assignments.publicTrackingToken,
      })
      .from(assignments)
      .where(and(eq(assignments.tripId, tripId), inArray(assignments.status, ASIGNACION_ACTIVA)))
      .limit(1);
    const asignacion = fila
      ? {
          id: fila.id,
          status: fila.status,
          empresaId: fila.empresaId,
          driverUserId: fila.driverUserId,
        }
      : null;

    const enlaceRenovado = Boolean(fila?.publicTrackingToken) && contactoAnteriorCambio;
    if (fila && enlaceRenovado) {
      // rls-allowlist: UPDATE por id de la asignación del viaje ya validado contra empresaId.
      await tx
        .update(assignments)
        .set({ publicTrackingToken: randomUUID() })
        .where(eq(assignments.id, fila.id));
    }

    logger.info(
      { tripId, campos, conAsignacion: Boolean(asignacion), enlaceRenovado },
      'datos libres de la carga editados',
    );
    return {
      ok: true,
      campos,
      enlaceRenovado,
      reenviarEnlace: enlaceRenovado ? contactoVigente : reenviarEnlace,
      asignacion,
    } as const;
  });
}
