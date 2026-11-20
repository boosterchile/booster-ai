import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type AssignmentRow, assignments, eventosRuta, paradasRuta, rutas } from '../db/schema.js';

/** La transacción de quien llama: la ruta nace junto con la asignación. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Crea la ruta de dos paradas de una asignación recién aceptada (ADR-088,
 * spec ruta-parada-servicio §4.1) y deja `asignaciones.ruta_id` apuntando a
 * ella. Corre dentro de la transacción del accept: o existen las dos, o
 * ninguna.
 *
 * La ruta hereda de la asignación la empresa, el vehículo, el arrastre y el
 * conductor. Hasta la parte 4 de la spec esos datos se siguen leyendo de la
 * asignación; la ruta todavía no tiene lectores.
 */
export async function crearRutaDeAsignacion(
  tx: Tx,
  opts: {
    readonly assignment: Pick<
      AssignmentRow,
      'id' | 'tripId' | 'empresaId' | 'vehicleId' | 'unidadArrastreId' | 'driverUserId'
    >;
    readonly userId: string | null;
  },
): Promise<{ rutaId: string }> {
  const { assignment, userId } = opts;
  const [ruta] = await tx
    .insert(rutas)
    .values({
      empresaId: assignment.empresaId,
      vehicleId: assignment.vehicleId,
      unidadArrastreId: assignment.unidadArrastreId,
      driverUserId: assignment.driverUserId,
      status: 'planificada',
    })
    .returning({ id: rutas.id });
  if (!ruta) {
    throw new Error('Insert ruta returned no row');
  }
  await tx.insert(paradasRuta).values([
    { rutaId: ruta.id, orden: 0, tipo: 'recogida', tripId: assignment.tripId },
    { rutaId: ruta.id, orden: 1, tipo: 'entrega', tripId: assignment.tripId },
  ]);
  await tx.insert(eventosRuta).values({
    rutaId: ruta.id,
    tipo: 'ruta_creada',
    payload: { viaje_id: assignment.tripId, asignacion_id: assignment.id },
    recordedByUserId: userId,
  });
  // rls-allowlist: asignación recién insertada en esta misma transacción (id propio)
  await tx.update(assignments).set({ rutaId: ruta.id }).where(eq(assignments.id, assignment.id));
  return { rutaId: ruta.id };
}
