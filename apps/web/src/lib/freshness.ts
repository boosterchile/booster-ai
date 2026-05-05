/**
 * Helpers para mostrar la "frescura" (cuánto hace) de un timestamp.
 *
 * Usado en vistas de tracking GPS, mensajes de chat, eventos de viaje y
 * cualquier lugar donde necesitemos comunicar "última actualización: hace X".
 *
 * Sin dep externa (date-fns no está en el bundle del web). Las funciones son
 * puras y testables.
 */

/** Segundos transcurridos desde `date` hasta `now()`. Null si `date` es null. */
export function ageSeconds(date: Date | string | null | undefined): number | null {
  if (date == null) {
    return null;
  }
  const ts = typeof date === 'string' ? Date.parse(date) : date.getTime();
  if (Number.isNaN(ts)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

/**
 * "ahora", "hace 5s", "hace 2 min", "hace 1 h 12 min", "hace 3 días".
 *
 * Devuelve null si `seconds` es null (sin dato).
 */
export function formatAge(seconds: number | null): string | null {
  if (seconds == null) {
    return null;
  }
  if (seconds < 5) {
    return 'ahora';
  }
  if (seconds < 60) {
    return `hace ${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const remMin = minutes % 60;
    return remMin > 0 ? `hace ${hours} h ${remMin} min` : `hace ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'hace 1 día' : `hace ${days} días`;
}

/**
 * Niveles de frescura para colorear el indicador en UI.
 *
 *   - 'fresh':   < staleSeconds (default 5 min). Verde / neutro.
 *   - 'stale':   ≥ staleSeconds y < oldSeconds (default 1 h). Amarillo.
 *   - 'old':     ≥ oldSeconds. Rojo.
 *   - 'unknown': sin dato.
 *
 * Aplicar al `className` con los tonos:
 *   fresh   → 'text-neutral-700'
 *   stale   → 'text-amber-700'
 *   old     → 'text-rose-700'
 *   unknown → 'text-neutral-400'
 */
export type FreshnessLevel = 'fresh' | 'stale' | 'old' | 'unknown';

export interface FreshnessThresholds {
  /** Segundos a partir de los cuales el dato pasa de fresh → stale. Default 5 min. */
  staleSeconds?: number;
  /** Segundos a partir de los cuales el dato pasa de stale → old. Default 1 h. */
  oldSeconds?: number;
}

const DEFAULT_STALE_SECONDS = 5 * 60;
const DEFAULT_OLD_SECONDS = 60 * 60;

export function freshnessLevel(
  seconds: number | null,
  opts: FreshnessThresholds = {},
): FreshnessLevel {
  if (seconds == null) {
    return 'unknown';
  }
  const stale = opts.staleSeconds ?? DEFAULT_STALE_SECONDS;
  const old = opts.oldSeconds ?? DEFAULT_OLD_SECONDS;
  if (seconds >= old) {
    return 'old';
  }
  if (seconds >= stale) {
    return 'stale';
  }
  return 'fresh';
}

/** Clase CSS Tailwind correspondiente al nivel. */
export function freshnessClass(level: FreshnessLevel): string {
  switch (level) {
    case 'fresh':
      return 'text-neutral-700';
    case 'stale':
      return 'text-amber-700';
    case 'old':
      return 'text-rose-700 font-medium';
    case 'unknown':
      return 'text-neutral-400';
  }
}
