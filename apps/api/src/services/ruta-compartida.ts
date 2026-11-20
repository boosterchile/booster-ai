import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, rutas } from '../db/schema.js';

/**
 * La ruta de un viaje cuando la comparte con otros servicios. `null` si el
 * viaje va solo en su ruta o todavía no tiene ruta.
 */
export async function rutaCompartidaDelViaje(
  db: Db,
  tripId: string,
): Promise<{ readonly rutaId: string; readonly cerrada: boolean } | null> {
  // rls-allowlist: asignación del viaje ya validado por quien llama (tripId)
  const [asignacion] = await db
    .select({ rutaId: assignments.rutaId })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const rutaId = asignacion?.rutaId ?? null;
  if (rutaId === null) {
    return null;
  }
  // rls-allowlist: servicios de la ruta de un viaje ya validado por quien llama
  const servicios = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(eq(assignments.rutaId, rutaId))
    .limit(2);
  if (servicios.length < 2) {
    return null;
  }
  // rls-allowlist: ruta por id, tomada de la asignación de un viaje ya validado
  const [ruta] = await db
    .select({ status: rutas.status })
    .from(rutas)
    .where(eq(rutas.id, rutaId))
    .limit(1);
  return { rutaId, cerrada: ruta?.status === 'cerrada' };
}
