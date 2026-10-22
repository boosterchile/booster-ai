import { puedeEjecutarViaje } from '@booster-ai/shared-schemas';

/**
 * Quién ejecuta este viaje.
 *
 * CHEQUEOS_REEMPLAZADOS entrega-incidente-ui: antes comparaba los ids
 * acá. Ahora delega en `puedeEjecutarViaje`. El rol no decide.
 */
export function esConductorDelViaje(
  viewerUserId: string | null | undefined,
  driverUserId: string | null | undefined,
): boolean {
  return puedeEjecutarViaje(viewerUserId, driverUserId);
}
