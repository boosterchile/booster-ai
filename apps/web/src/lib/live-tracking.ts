/**
 * Texto compartido del tracking en vivo (público `/tracking/$token` y
 * generador `/app/cargas/$id/track`). Spec: `.specs/tracking-live-unificado/`.
 *
 * Funciones puras: el API decide la fuente y el ETA; acá solo se nombran.
 */

/** Espejo de `LivePositionSource` del API (`services/posicion-en-vivo.ts`). */
export type PositionSource = 'teltonika' | 'mobile';

/** De dónde sale la posición mostrada. null si no hay fuente (sin posición). */
export function positionSourceLabel(source: PositionSource | null | undefined): string | null {
  if (source === 'teltonika') {
    return 'Posición reportada por el GPS del vehículo';
  }
  if (source === 'mobile') {
    return 'Posición reportada por el teléfono del conductor';
  }
  return null;
}

/** "en 12 min", "en 1 h 35 min", "en 2 h". */
export function formatEta(minutes: number): string {
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) {
    return `en ${total} min`;
  }
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins > 0 ? `en ${hours} h ${mins} min` : `en ${hours} h`;
}

/**
 * Línea de ETA. Con posición y sin ETA se dice explícitamente (el vehículo está
 * detenido o el teléfono no reporta velocidad): nunca un número inventado.
 */
export function etaLine(etaMinutes: number | null | undefined): string {
  return etaMinutes != null
    ? `Llegada estimada: ${formatEta(etaMinutes)}`
    : 'Llegada estimada: no disponible aún';
}
