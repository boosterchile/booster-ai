import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conductorDeAsignacion } from '../db/configuracion-de-asignacion.js';
import { assignments, trips } from '../db/schema.js';

/**
 * Estados de assignment (`estado_asignacion`) que mantienen vigente el vínculo
 * transportista↔viaje para autorizar acceso a lo adjunto al viaje. Excluye
 * `cancelado`: un assignment cancelado NO debe seguir autorizando al
 * transportista (review F4-4a finding 2). Si el transportista vuelve a quedar
 * asignado, será una fila nueva con estado vigente (la tabla tiene UNIQUE por
 * viaje_id, así que a lo más una vigente).
 */
export const ASSIGNMENT_ESTADOS_VIGENTES = ['asignado', 'recogido', 'entregado'] as const;

export type AutorizacionSobreViaje =
  | { exists: false; authorized: false }
  | { exists: true; authorized: false }
  | { exists: true; authorized: true; lado: 'generador' | 'transportista' };

/**
 * Decide si la empresa activa (`empresaId`) puede operar sobre lo adjunto al
 * viaje `tripId` (documentos de transporte, instrucciones de retiro):
 *
 *   - la generadora dueña del viaje (`lado: 'generador'`), o
 *   - la transportista con una asignación vigente (`lado: 'transportista'`).
 *
 * El rol `conductor` ve solo su viaje (`veSoloSuViaje`): entra únicamente con
 * una asignación vigente a su nombre (`conductor_id` guarda un `usuarios.id`),
 * también en una empresa que además es la generadora (#882).
 */
export async function autorizarSobreViaje(
  db: Db,
  tripId: string,
  empresaId: string,
  actor: { role: string; userId: string },
): Promise<AutorizacionSobreViaje> {
  const tripRows = await db
    .select({ id: trips.id, generadorCargaEmpresaId: trips.generadorCargaEmpresaId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const trip = tripRows[0];
  if (!trip) {
    return { exists: false, authorized: false };
  }
  const esConductor = actor.role === 'conductor';
  if (!esConductor && trip.generadorCargaEmpresaId === empresaId) {
    return { exists: true, authorized: true, lado: 'generador' };
  }
  const asgRows = await db
    .select({ empresaId: assignments.empresaId, driverUserId: conductorDeAsignacion })
    .from(assignments)
    .where(
      and(eq(assignments.tripId, tripId), inArray(assignments.status, ASSIGNMENT_ESTADOS_VIGENTES)),
    )
    .limit(1);
  const asg = asgRows[0];
  if (asg && asg.empresaId === empresaId && (!esConductor || asg.driverUserId === actor.userId)) {
    return { exists: true, authorized: true, lado: 'transportista' };
  }
  return { exists: true, authorized: false };
}
