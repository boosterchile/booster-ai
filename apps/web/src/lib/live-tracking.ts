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

/**
 * El GET de tracking no se puede cachear: el body trae la edad del ping
 * (`last_position_age_seconds` / `timestamp_device`) y un `Cache-Control`
 * fresco haría que el poll y el botón Refrescar repitieran el primer snapshot.
 */
export const LIVE_TRACKING_FETCH: RequestInit = { cache: 'no-store' };

/**
 * El QueryClient de la app apaga `refetchOnWindowFocus`. TanStack, además,
 * salta el `refetchInterval` mientras `document.hidden`. En Safari móvil el
 * seguimiento quedaba en el primer snapshot al volver de segundo plano.
 * Estas opciones valen para el link público y para `/app/cargas/$id/track`.
 */
export const LIVE_TRACKING_QUERY = {
  staleTime: 0,
  refetchOnWindowFocus: 'always' as const,
  refetchIntervalInBackground: true,
};

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
