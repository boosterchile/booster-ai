import type { Logger } from '@booster-ai/logger';
import { assertTransicion } from '@booster-ai/trip-state-machine';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripEvents, trips } from '../db/schema.js';

/**
 * Confirmar recogida — el paso que la máquina de estados modelaba y nadie
 * escribía.
 *
 * `viajes: asignado → en_proceso` y `asignaciones: asignado → recogido` estaban
 * declarados desde 2026-06 (el propio `trip-state-machine` lo anota: «pickup
 * MODELADO pero aún sin flujo que lo dispare»), con columnas `recogido_en` y
 * `evidencia_recogida_url` vacías y el tipo de evento `recogida_confirmada` ya
 * en el enum. Ocho lugares LEÍAN el estado; ninguno lo escribía.
 *
 * El costo era visible: la pantalla de Servicios decía «Por recoger» para un
 * camión que ya iba por la ruta, y el tracking del consignatario nunca mostraba
 * posición (`get-public-tracking` solo la expone en `asignado|en_proceso`).
 *
 * Las DOS capas se escriben en la misma transacción a propósito: dejar el
 * assignment en `recogido` con el viaje en `asignado` produciría exactamente
 * la incoherencia que esto viene a cerrar.
 */

export interface ConfirmarRecogidaActor {
  userId: string;
  /** Empresa activa del actor. Se compara contra la dueña del assignment. */
  empresaId: string;
  /** El actor es el conductor asignado a ESTE servicio. */
  esConductorAsignado: boolean;
  /**
   * El actor es miembro del transportista con rol de escritura
   * (`dueno|admin|despachador`). Respaldo de oficina: un conductor sin
   * smartphone o sin señal en un patio no puede congelar la operación.
   */
  esCarrierConEscritura?: boolean;
}

export type ConfirmarRecogidaResult =
  | { ok: true; alreadyPickedUp: boolean; pickedUpAt: Date; tripId: string }
  | {
      ok: false;
      code: 'assignment_not_found' | 'forbidden' | 'invalid_status' | 'invalid_picked_up_at';
      currentStatus?: string;
    };

/**
 * Tolerancia hacia el futuro para un `pickedUpAt` provisto por el cliente:
 * absorbe el skew de reloj de un celular sin aceptar "recogidas" que aún no
 * ocurrieron. Ese instante ancla la ventana de medición de huella (T11/T12),
 * por eso se acota en el servidor y no se confía a ciegas.
 */
export const PICKED_UP_AT_FUTURE_SKEW_MS = 2 * 60_000;

export async function confirmarRecogidaViaje(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  actor: ConfirmarRecogidaActor;
  /**
   * Instante real de la recogida cuando lo aporta el cliente (T9: cruce del
   * geofence del origen). Ausente → `now` (tap manual). Se acota: no puede
   * estar en el futuro más allá del skew ni antes de la aceptación del
   * servicio; fuera de cotas → `invalid_picked_up_at` sin escribir nada.
   */
  pickedUpAt?: Date | undefined;
}): Promise<ConfirmarRecogidaResult> {
  const { db, logger, assignmentId, actor, pickedUpAt: pickedUpAtProvisto } = opts;

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        assignmentId: assignments.id,
        assignmentStatus: assignments.status,
        driverUserId: assignments.driverUserId,
        pickedUpAt: assignments.pickedUpAt,
        acceptedAt: assignments.acceptedAt,
        empresaId: assignments.empresaId,
        tripId: assignments.tripId,
        tripStatus: trips.status,
      })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      return { ok: false as const, code: 'assignment_not_found' as const };
    }

    // Autorización: el conductor asignado, o la oficina del transportista
    // dueño. La pertenencia a la empresa se valida contra la fila, no contra
    // lo que el caller afirme.
    const esSuConductor = actor.esConductorAsignado && row.driverUserId === actor.userId;
    const esSuEmpresa = actor.esCarrierConEscritura === true && row.empresaId === actor.empresaId;
    if (!esSuConductor && !esSuEmpresa) {
      logger.warn(
        { assignmentId, actorUserId: actor.userId },
        'confirmar-recogida rechazada: el actor no es el conductor ni la empresa dueña',
      );
      return { ok: false as const, code: 'forbidden' as const };
    }

    // Idempotencia ANTES de validar transiciones: repetir el toque devuelve el
    // estado que ya existe, sin duplicar el evento de auditoría.
    if (row.assignmentStatus === 'recogido') {
      return {
        ok: true as const,
        alreadyPickedUp: true as const,
        pickedUpAt: row.pickedUpAt ?? new Date(),
        tripId: row.tripId,
      };
    }

    if (row.assignmentStatus !== 'asignado') {
      return {
        ok: false as const,
        code: 'invalid_status' as const,
        currentStatus: row.assignmentStatus,
      };
    }

    // La legalidad la decide la tabla del trip-state-machine (ADR-061); este
    // service orquesta. Si el viaje no está en un estado desde el que se pueda
    // pasar a `en_proceso`, esto lanza y la transacción no escribe nada.
    try {
      assertTransicion(row.tripStatus, 'en_proceso');
    } catch {
      return {
        ok: false as const,
        code: 'invalid_status' as const,
        currentStatus: row.tripStatus,
      };
    }

    const now = new Date();

    // Cotas del instante provisto (T9). Se validan ANTES de escribir: fuera de
    // rango no se mueve ningún estado ni se inserta evento.
    if (pickedUpAtProvisto) {
      const demasiadoFuturo =
        pickedUpAtProvisto.getTime() > now.getTime() + PICKED_UP_AT_FUTURE_SKEW_MS;
      const anteriorAAceptacion = pickedUpAtProvisto.getTime() < row.acceptedAt.getTime();
      if (demasiadoFuturo || anteriorAAceptacion) {
        logger.warn(
          {
            assignmentId,
            pickedUpAt: pickedUpAtProvisto.toISOString(),
            acceptedAt: row.acceptedAt.toISOString(),
            motivo: demasiadoFuturo ? 'futuro' : 'anterior_a_aceptacion',
          },
          'confirmar-recogida rechazada: pickedUpAt fuera de cotas',
        );
        return { ok: false as const, code: 'invalid_picked_up_at' as const };
      }
    }
    const pickedUpAt = pickedUpAtProvisto ?? now;
    const pickedUpAtSource = pickedUpAtProvisto ? 'cliente' : 'servidor';

    // CAS por estado en el WHERE: si otro toque concurrente ya movió el viaje
    // entre el SELECT y el UPDATE, esto no afecta filas y abortamos. El
    // invariante queda en el SQL, no en la lectura previa.
    const aEnProceso = await tx
      .update(trips)
      .set({ status: 'en_proceso' })
      .where(and(eq(trips.id, row.tripId), inArray(trips.status, ['asignado'])))
      .returning({ id: trips.id });
    if (!aEnProceso[0]) {
      return {
        ok: false as const,
        code: 'invalid_status' as const,
        currentStatus: row.tripStatus,
      };
    }

    await tx
      .update(assignments)
      .set({ status: 'recogido', pickedUpAt })
      .where(and(eq(assignments.id, row.assignmentId), eq(assignments.status, 'asignado')))
      .returning({ id: assignments.id });

    await tx.insert(tripEvents).values({
      tripId: row.tripId,
      assignmentId: row.assignmentId,
      eventType: 'recogida_confirmada',
      source: 'web',
      recordedByUserId: actor.userId,
      payload: {
        actor_user_id: actor.userId,
        actor_empresa_id: actor.empresaId,
        confirmed_via: esSuConductor ? 'conductor' : 'carrier',
        picked_up_at: pickedUpAt.toISOString(),
        // 'cliente' = instante del cruce del geofence aportado por la PWA (T9);
        // 'servidor' = tap manual, now del API.
        picked_up_at_source: pickedUpAtSource,
      },
    });

    logger.info(
      {
        assignmentId,
        tripId: row.tripId,
        via: esSuConductor ? 'conductor' : 'carrier',
        pickedUpAtSource,
      },
      'recogida confirmada',
    );

    return {
      ok: true as const,
      alreadyPickedUp: false as const,
      pickedUpAt,
      tripId: row.tripId,
    };
  });
}
