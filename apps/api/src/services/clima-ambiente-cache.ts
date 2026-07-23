import type { Logger } from '@booster-ai/logger';

/**
 * Caché server-side de temperatura ambiente por **celda geográfica**.
 *
 * Constraint NO negociable (Google Maps Platform ToS, Weather API): la
 * "current condition" solo se puede cachear ≤ 1 hora, sin persistirla junto a
 * la telemetría ni guardar histórico. Por eso el caché es un **Map en memoria**
 * (efímero, muere con el proceso) con TTL corto — NO hay columna en BD ni
 * escritura a disco del dato de clima.
 *
 * Por qué por celda y no por vehículo/request: la vista live refresca cada 15s;
 * llamar a Weather en cada refetch quemaría el free tier sin sentido (Google
 * refresca cada 15-30 min y el clima es ~uniforme en ~10 km). Una celda de
 * 0.1° (~10 km) sirve una sola llamada para todos los vehículos cercanos.
 */

/** TTL del caché. 30 min: ≤ 1h (ToS) y alineado al refresh de Google (15-30 min). */
export const CLIMA_TTL_MS = 30 * 60 * 1000;

export interface ClimaCacheEntry {
  temperaturaC: number;
  fetchedAtMs: number;
}

/**
 * Caché singleton por proceso (una instancia de Cloud Run). Distintas
 * instancias tienen su propio Map — asumido y contemplado en el conteo de
 * llamadas (peor caso: instancias × celdas activas).
 */
export const climaCacheSingleton = new Map<string, ClimaCacheEntry>();

/** Redondea a 0.1° (~10 km) → key de celda estable "lat,lng". */
export function celdaKey(lat: number, lng: number): string {
  const r = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
  return `${r(lat)},${r(lng)}`;
}

/**
 * Devuelve la temperatura ambiente de la celda de `lat/lng`, usando el caché.
 *
 * - **Caliente** (age < TTL): sirve del caché, NO llama a la API.
 * - **Frío**: llama `fetchClima` (1 llamada), cachea y devuelve.
 * - **Fallo** de `fetchClima`: devuelve `null` (degrada, mismo null-safe de
 *   #612), sin cachear → la próxima lectura reintenta.
 *
 * Puro respecto del reloj (`nowMs`) y del caché (`cache`) inyectables → testeable.
 */
export async function obtenerTemperaturaAmbiente(opts: {
  lat: number;
  lng: number;
  nowMs: number;
  fetchClima: (lat: number, lng: number) => Promise<number>;
  cache?: Map<string, ClimaCacheEntry>;
  logger?: Logger;
}): Promise<number | null> {
  const { lat, lng, nowMs, fetchClima, cache = climaCacheSingleton, logger } = opts;
  const key = celdaKey(lat, lng);

  const entry = cache.get(key);
  if (entry && nowMs - entry.fetchedAtMs < CLIMA_TTL_MS) {
    return entry.temperaturaC;
  }

  try {
    const temperaturaC = await fetchClima(lat, lng);
    cache.set(key, { temperaturaC, fetchedAtMs: nowMs });
    return temperaturaC;
  } catch (err) {
    logger?.warn({ err, celda: key }, 'clima ambiente: fetch falló, degrada a null');
    return null;
  }
}
