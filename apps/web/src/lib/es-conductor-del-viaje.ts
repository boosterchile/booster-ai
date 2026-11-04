/**
 * Quién ejecuta este viaje.
 *
 * La asignación guarda al conductor en `conductor_id` (`driver_user_id` en
 * el JSON). Es la misma comparación que el API (`esConductorAsignado`):
 * el id del usuario autenticado contra el de la fila. Cubre al conductor
 * empleado y al transportista-conductor cuando él mismo quedó asignado.
 *
 * El rol de la membresía no decide: un dueño que se asignó el viaje
 * conduce, y un administrador que no es ese usuario no.
 */
export function esConductorDelViaje(
  viewerUserId: string | null | undefined,
  driverUserId: string | null | undefined,
): boolean {
  if (viewerUserId == null || driverUserId == null) {
    return false;
  }
  if (viewerUserId.length === 0 || driverUserId.length === 0) {
    return false;
  }
  return viewerUserId === driverUserId;
}
