/**
 * Pantalla donde la persona confirma, con su sesión iniciada, el código que le
 * entregó en persona el admin de Booster (`.specs/confirmar-acceso-booster`
 * SC16 y SC18).
 */
export const RUTA_CONFIRMAR_ACCESO_BOOSTER = '/app/confirmar-acceso-booster';

/** Dirección absoluta de la pantalla, para entregarla junto al código de confirmación. */
export function urlConfirmarAccesoBooster(origin: string = window.location.origin): string {
  return `${origin}${RUTA_CONFIRMAR_ACCESO_BOOSTER}`;
}
