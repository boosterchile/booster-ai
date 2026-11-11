import type { Logger } from '@booster-ai/logger';
import {
  esAnulablePorGenerador,
  esCancelablePostMatch,
  esEstadoViaje,
} from '@booster-ai/trip-state-machine';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conductorDeAsignacion } from '../db/configuracion-de-asignacion.js';
import { assignments, offers, tripEvents, trips } from '../db/schema.js';
import { sincronizarRutaDeAsignacion } from './sincronizar-ruta-de-asignacion.js';
import { invalidarSolicitudPendiente } from './solicitud-cambio-carga.js';

/**
 * Anular o cancelar una carga (spec editar-anular-cargas §6.6, §12-P6).
 *
 *   - Antes del match (`esAnulablePorGenerador`): se anula. Las ofertas
 *     pendientes expiran. La carga sale de las listas del generador y queda en
 *     la BD con fecha y autor (evento `cancelado {tipo:'anulacion'}`). Motivo
 *     opcional.
 *   - Después del match (`esCancelablePostMatch`, solo `asignado`): se cancela
 *     el viaje y la asignación, con motivo obligatorio y las columnas de
 *     cancelación de `asignaciones`. El llamador avisa a la transportista y al
 *     conductor después del commit.
 *
 * Nunca hay borrado físico. Todo en una transacción con lock del viaje, que
 * serializa contra `acceptOffer` y contra la recogida.
 */

export type ResultadoCancelacion =
  | {
      ok: true;
      tipo: 'anulacion';
      ofertasInvalidadas: number;
      asignacion: null;
    }
  | {
      ok: true;
      tipo: 'cancelacion';
      ofertasInvalidadas: 0;
      asignacion: { id: string; empresaId: string; driverUserId: string | null };
      motivo: string;
      /**
       * La ruta que esta cancelación dejó cerrada: la carga cancelada era la
       * única parada pendiente de una ruta con otras cargas ya entregadas.
       * Quien llama calcula su huella y emite los certificados después del
       * commit (huella-consolidada §3.9).
       */
      rutaCerradaId: string | null;
    }
  | { ok: false; code: 'trip_not_found' }
  | { ok: false; code: 'trip_not_cancellable'; currentStatus: string }
  | { ok: false; code: 'reason_required' };

export async function cancelarCarga(
  deps: { db: Db; logger: Logger },
  opts: { tripId: string; empresaId: string; userId: string; reason?: string },
): Promise<ResultadoCancelacion> {
  const { db, logger } = deps;
  const { tripId, empresaId, userId } = opts;
  const motivo = opts.reason?.trim() ? opts.reason.trim() : null;

  return await db.transaction(async (tx) => {
    const [viaje] = await tx
      .select({ status: trips.status, trackingCode: trips.trackingCode })
      .from(trips)
      .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
      .for('update')
      .limit(1);
    if (!viaje) {
      return { ok: false, code: 'trip_not_found' } as const;
    }
    const estado = viaje.status;
    const now = new Date();

    if (esEstadoViaje(estado) && esAnulablePorGenerador(estado)) {
      await tx
        .update(trips)
        .set({ status: 'cancelado', updatedAt: now })
        .where(and(eq(trips.id, tripId), eq(trips.generadorCargaEmpresaId, empresaId)))
        .returning({ id: trips.id });
      // Sin esto las ofertas pendientes quedaban aceptables hasta su TTL.
      const invalidadas = await tx
        .update(offers)
        .set({ status: 'expirada', updatedAt: now })
        .where(and(eq(offers.tripId, tripId), eq(offers.status, 'pendiente')))
        .returning({ id: offers.id });
      await tx.insert(tripEvents).values({
        tripId,
        eventType: 'cancelado',
        source: 'web',
        recordedByUserId: userId,
        payload: {
          tipo: 'anulacion',
          actor: 'generador_carga',
          previous_status: estado,
          invalidated_offers: invalidadas.length,
          ...(motivo ? { reason: motivo } : {}),
        },
      });
      logger.info(
        { tripId, trackingCode: viaje.trackingCode, previousStatus: estado },
        'carga anulada por el generador',
      );
      return {
        ok: true,
        tipo: 'anulacion',
        ofertasInvalidadas: invalidadas.length,
        asignacion: null,
      } as const;
    }

    if (esEstadoViaje(estado) && esCancelablePostMatch(estado)) {
      if (!motivo) {
        return { ok: false, code: 'reason_required' } as const;
      }
      // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
      const [asignacion] = await tx
        .select({
          id: assignments.id,
          empresaId: assignments.empresaId,
          driverUserId: conductorDeAsignacion,
        })
        .from(assignments)
        .where(and(eq(assignments.tripId, tripId), eq(assignments.status, 'asignado')))
        .for('update')
        .limit(1);
      if (!asignacion) {
        return { ok: false, code: 'trip_not_cancellable', currentStatus: estado } as const;
      }
      await tx
        .update(trips)
        .set({ status: 'cancelado', updatedAt: now })
        .where(
          and(
            eq(trips.id, tripId),
            eq(trips.generadorCargaEmpresaId, empresaId),
            eq(trips.status, 'asignado'),
          ),
        )
        .returning({ id: trips.id });
      // rls-allowlist: asignación del viaje ya validado contra la empresa generadora (empresaId).
      const canceladas = await tx
        .update(assignments)
        .set({
          status: 'cancelado',
          cancelledByActor: 'generador_carga',
          cancellationReason: motivo,
          cancelledAt: now,
          updatedAt: now,
        })
        .where(and(eq(assignments.id, asignacion.id), eq(assignments.status, 'asignado')))
        .returning({ id: assignments.id });
      if (canceladas.length === 0) {
        // Con el lock de la asignación no debería pasar; si pasa, se aborta
        // la transacción para no dejar el viaje cancelado con la asignación viva.
        throw new Error(`no se pudo cancelar la asignación ${asignacion.id} (estado cambió)`);
      }
      // La ruta sigue a la asignación (ADR-088): queda `cancelada`.
      const sincronizada = await sincronizarRutaDeAsignacion(tx, {
        asignacionId: asignacion.id,
        origen: 'carga_cancelada',
        userId,
        logger,
      });
      const rutaCerradaId =
        sincronizada.tipo === 'conciliada' &&
        sincronizada.hacia === 'cerrada' &&
        sincronizada.desde !== 'cerrada'
          ? sincronizada.rutaId
          : null;
      // Una solicitud de cambio pendiente ya no tiene a quién aplicarse (§6.6).
      const solicitudInvalidada = await invalidarSolicitudPendiente(tx, {
        tripId,
        userId,
        motivo: 'viaje_cancelado',
      });
      await tx.insert(tripEvents).values({
        tripId,
        assignmentId: asignacion.id,
        eventType: 'cancelado',
        source: 'web',
        recordedByUserId: userId,
        payload: {
          tipo: 'cancelacion',
          actor: 'generador_carga',
          previous_status: estado,
          assignment_id: asignacion.id,
          reason: motivo,
        },
      });
      logger.info(
        {
          tripId,
          trackingCode: viaje.trackingCode,
          assignmentId: asignacion.id,
          solicitudInvalidada,
        },
        'carga cancelada por el generador después del match',
      );
      return {
        ok: true,
        tipo: 'cancelacion',
        ofertasInvalidadas: 0,
        asignacion,
        motivo,
        rutaCerradaId,
      } as const;
    }

    return { ok: false, code: 'trip_not_cancellable', currentStatus: estado } as const;
  });
}
