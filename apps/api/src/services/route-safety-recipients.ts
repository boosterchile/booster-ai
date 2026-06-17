/**
 * Safety notification routing (Task 8).
 *
 * Resuelve un vehicleId/imei de telemetría a los dueños del transportista
 * que deben recibir una notificación de seguridad, junto con el tracking
 * code del viaje activo (si lo hay) y los datos de la empresa.
 *
 * Active-assignment: status IN ('asignado', 'recogido') — alineado con la
 * lógica de apps/api/src/routes/assignments.ts:428 que define un viaje
 * activo para Teltonika como aquél en estado 'asignado' o 'recogido'.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, memberships, trips, users, vehicles } from '../db/schema.js';

export interface SafetyRecipient {
  userId: string;
  phoneE164: string | null;
}

export interface SafetyRouting {
  empresaId: string;
  vehicleLabel: string;
  trackingCode: string | null;
  recipients: SafetyRecipient[];
}

/**
 * Resuelve los destinatarios de una notificación de seguridad a partir de
 * un vehículo identificado por telemetría (imei o vehicleId).
 *
 * @returns SafetyRouting con empresa, label del vehículo, código de
 *   seguimiento del viaje activo (o null si está estacionado) y lista de
 *   dueños activos del transportista.
 *   Retorna null si el vehículo no se encuentra en la BD.
 */
export async function routeSafetyRecipients(opts: {
  db: Db;
  imei: string;
  vehicleId?: string;
}): Promise<SafetyRouting | null> {
  const { db, imei, vehicleId } = opts;

  // 1. Resolver el vehículo: por vehicleId si se provee, si no por imei.
  //    NOT teltonikaImeiEspejo — solo el IMEI real ('teltonika_imei').
  const vehicleRows = await db
    .select({
      id: vehicles.id,
      empresaId: vehicles.empresaId,
      plate: vehicles.plate,
    })
    .from(vehicles)
    .where(vehicleId !== undefined ? eq(vehicles.id, vehicleId) : eq(vehicles.teltonikaImei, imei))
    .limit(1);

  const vehicle = vehicleRows[0];
  if (!vehicle) {
    return null;
  }

  // 2. Buscar la asignación activa del vehículo (si hay una).
  //    Activa = status IN ('asignado', 'recogido') — el vehículo está en ruta.
  //    Si no hay asignación activa el camión está estacionado; se notifica igual
  //    pero sin trackingCode.
  const activeAssignmentRows = await db
    .select({ trackingCode: trips.trackingCode })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(
      and(
        eq(assignments.vehicleId, vehicle.id),
        inArray(assignments.status, ['asignado', 'recogido']),
      ),
    )
    .limit(1);

  const trackingCode = activeAssignmentRows[0]?.trackingCode ?? null;

  // 3. Resolver los dueños activos del transportista.
  //    Patrón copiado de notify-offer.ts:72-81 (memberships innerJoin users,
  //    role='dueno', status='activa') con la diferencia de que acá devolvemos
  //    TODOS los dueños (sin .limit(1)) porque safety notifications van a todos.
  const duenoRows = await db
    .select({
      userId: memberships.userId,
      phoneE164: users.phone,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.empresaId, vehicle.empresaId),
        eq(memberships.role, 'dueno'),
        eq(memberships.status, 'activa'),
      ),
    );

  const recipients: SafetyRecipient[] = duenoRows.map((row) => ({
    userId: row.userId,
    phoneE164: row.phoneE164 ?? null,
  }));

  return {
    empresaId: vehicle.empresaId,
    vehicleLabel: vehicle.plate,
    trackingCode,
    recipients,
  };
}
