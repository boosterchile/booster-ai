import type { Logger } from '@booster-ai/logger';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, conductores, tripEvents, users } from '../db/schema.js';

/**
 * Asigna un conductor específico a un assignment existente.
 *
 * Contexto: hasta acá, el flujo del accept-offer creaba el assignment con
 * `driver_user_id = NULL` y no había forma de setearlo después. El
 * resultado: el endpoint `/assignments/:id/driver-position` (que valida
 * `assignment.driverUserId === user.id`) era inalcanzable, y la UI
 * `/app/conductor` exigía que el conductor pegara manualmente el
 * UUID del assignment (UX placeholder).
 *
 * Este servicio cierra el flujo: el carrier (dueño/admin/despachador)
 * elige uno de sus conductores activos y lo asocia al assignment.
 *
 * Reglas:
 *   1. El assignment debe existir y pertenecer al carrier que invoca.
 *   2. El driver_user_id debe corresponder a un conductor ACTIVO de
 *      ese mismo carrier (sino, un carrier podría asignar conductores
 *      de otra empresa — riesgo de filtrado de datos).
 *   3. El assignment NO puede estar finalizado (cancelado/entregado).
 *      Para reasignaciones mid-trip por ahora bloqueamos; cuando aparezca
 *      el caso de uso real lo añadimos como `allow_reassign`.
 *   4. Si el assignment ya tiene driver_user_id seteado, permitimos
 *      cambiarlo siempre que el assignment esté en estado `asignado` o
 *      `en_proceso`. La auditoría queda en trip_events.
 *
 * Side effect:
 *   - UPDATE assignments SET driver_user_id, updated_at
 *   - INSERT trip_events { event_type='conductor_asignado', payload }
 *
 * Decisión de modelo: el campo es `driver_user_id` (users.id), NO
 * `conductor_id` (conductores.id). Razón: el endpoint del driver
 * (driver-position) hace `assignment.driverUserId === userContext.user.id`,
 * el matching natural con el user autenticado vía Firebase. La tabla
 * conductores guarda metadata extra (licencia, PIN de activación) pero
 * el `users.id` es el handle estable.
 */

export class AssignmentNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Assignment ${id} not found`);
    this.name = 'AssignmentNotFoundError';
  }
}

export class AssignmentNotOwnedError extends Error {
  constructor(
    public readonly id: string,
    public readonly empresaId: string,
  ) {
    super(`Assignment ${id} is not owned by empresa ${empresaId}`);
    this.name = 'AssignmentNotOwnedError';
  }
}

export class AssignmentNotMutableError extends Error {
  constructor(
    public readonly id: string,
    public readonly status: string,
  ) {
    super(`Assignment ${id} is in status ${status}, cannot reassign driver`);
    this.name = 'AssignmentNotMutableError';
  }
}

export class DriverNotInCarrierError extends Error {
  constructor(
    public readonly driverUserId: string,
    public readonly empresaId: string,
  ) {
    super(`Driver ${driverUserId} is not an active conductor of empresa ${empresaId}`);
    this.name = 'DriverNotInCarrierError';
  }
}

export interface AsignarConductorInput {
  db: Db;
  logger: Logger;
  assignmentId: string;
  driverUserId: string;
  /** Empresa carrier que está haciendo la asignación. */
  empresaId: string;
  /** User id del operador que dispara la asignación (audit). */
  actingUserId: string;
}

export interface AsignarConductorOutput {
  assignmentId: string;
  previousDriverUserId: string | null;
  newDriverUserId: string;
  driverName: string | null;
}

/**
 * Estados en los que SÍ se puede asignar/cambiar conductor. Una vez
 * `entregado` o `cancelado`, el assignment es terminal — no tiene sentido
 * tocar el conductor. Cuando ya está `recogido` (en tránsito) hace sentido
 * permitir reasignación (ej. relevo de chofer en mid-trip), aunque ese
 * caso de uso es raro y el cliente puede deshabilitarlo en la UI.
 */
const MUTABLE_STATUSES = ['asignado', 'recogido'] as const;

export async function asignarConductorAAssignment(
  input: AsignarConductorInput,
): Promise<AsignarConductorOutput> {
  const { db, logger, assignmentId, driverUserId, empresaId, actingUserId } = input;

  return await db.transaction(async (tx) => {
    // 1. Verificar assignment existe + pertenece al carrier + es mutable.
    const [assignment] = await tx
      .select({
        id: assignments.id,
        empresaId: assignments.empresaId,
        status: assignments.status,
        driverUserId: assignments.driverUserId,
        tripId: assignments.tripId,
      })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!assignment) {
      throw new AssignmentNotFoundError(assignmentId);
    }
    if (assignment.empresaId !== empresaId) {
      throw new AssignmentNotOwnedError(assignmentId, empresaId);
    }
    if (!(MUTABLE_STATUSES as readonly string[]).includes(assignment.status)) {
      throw new AssignmentNotMutableError(assignmentId, assignment.status);
    }

    // 2. Verificar driver_user_id es un conductor activo del MISMO carrier.
    //    El JOIN con users sirve para sacar el fullName para el audit log.
    const [driverRow] = await tx
      .select({
        userId: users.id,
        userFullName: users.fullName,
        conductorId: conductores.id,
      })
      .from(conductores)
      .innerJoin(users, eq(users.id, conductores.userId))
      .where(
        and(
          eq(conductores.userId, driverUserId),
          eq(conductores.empresaId, empresaId),
          isNull(conductores.deletedAt),
        ),
      )
      .limit(1);

    if (!driverRow) {
      throw new DriverNotInCarrierError(driverUserId, empresaId);
    }

    // 3. UPDATE assignment.
    await tx
      .update(assignments)
      .set({
        driverUserId,
        updatedAt: new Date(),
      })
      .where(eq(assignments.id, assignmentId));

    // 4. Audit event en trip_events.
    await tx.insert(tripEvents).values({
      tripId: assignment.tripId,
      eventType: 'conductor_asignado',
      payload: {
        assignment_id: assignmentId,
        previous_driver_user_id: assignment.driverUserId,
        new_driver_user_id: driverUserId,
        driver_name: driverRow.userFullName,
        acting_user_id: actingUserId,
      },
      // El audit lo dispara la UI del carrier, así que source='web'.
      // Si en el futuro un cron asigna automáticamente, ajustar a 'sistema'.
      source: 'web',
    });

    logger.info(
      {
        assignmentId,
        previousDriverUserId: assignment.driverUserId,
        newDriverUserId: driverUserId,
        empresaId,
      },
      'conductor asignado a assignment',
    );

    return {
      assignmentId,
      previousDriverUserId: assignment.driverUserId,
      newDriverUserId: driverUserId,
      driverName: driverRow.userFullName ?? null,
    };
  });
}
