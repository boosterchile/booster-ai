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
      code: 'assignment_not_found' | 'forbidden' | 'invalid_status';
      currentStatus?: string;
    };

export async function confirmarRecogidaViaje(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  actor: ConfirmarRecogidaActor;
}): Promise<ConfirmarRecogidaResult> {
  const { db, logger, assignmentId, actor } = opts;

  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        assignmentId: assignments.id,
        assignmentStatus: assignments.status,
        driverUserId: assignments.driverUserId,
        pickedUpAt: assignments.pickedUpAt,
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
      .set({ status: 'recogido', pickedUpAt: now })
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
        picked_up_at: now.toISOString(),
      },
    });

    logger.info(
      { assignmentId, tripId: row.tripId, via: esSuConductor ? 'conductor' : 'carrier' },
      'recogida confirmada',
    );

    return {
      ok: true as const,
      alreadyPickedUp: false as const,
      pickedUpAt: now,
      tripId: row.tripId,
    };
  });
}
