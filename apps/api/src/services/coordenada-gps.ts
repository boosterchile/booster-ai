import { type SQL, and, isNotNull, sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * Validez de una coordenada GPS de telemetría (read path).
 *
 * Descarta:
 *   - NaN / Infinity (rows malformados, no coercibles).
 *   - El **"null island"**: `lat === 0` y/o `lng === 0`. Es el sentinela de un
 *     record SIN fix GPS (el device emite 0,0 cuando no fijó satélites). Chile
 *     continental jamás está en lat=0 ni lng=0 (lat ∈ [-56,-17], lng ∈
 *     [-76,-66]) → un 0 en cualquiera de los ejes es SIEMPRE inválido, con cero
 *     falsos positivos.
 *
 * Se prefiere el discriminador 0,0 sobre `satellites === 0`: el recon
 * (2026-07-24) encontró un punto 0,0 real que reportaba `satellites = 6` — el
 * conteo de satélites NO es confiable, el 0,0 sí. `Number.isFinite(0)` es
 * `true`, por eso el filtro previo (solo isFinite/isNotNull) no los agarraba y
 * la traza dibujaba una recta Chile→Golfo de Guinea (dist inflada ~18.000 km).
 *
 * Función pura. NO toca la ingesta: los puntos crudos se conservan; esto solo
 * filtra al LEER.
 */
export function esCoordenadaGpsValida(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

/**
 * Mismo criterio que `esCoordenadaGpsValida` a nivel query (WHERE de Drizzle):
 * descarta null y 0 en ambos ejes. Para readers que filtran en la DB (última
 * posición: /ubicacion, /flota, tracking público, ubicación en assignments).
 */
export function coordenadaGpsValidaSql(lat: AnyColumn, lng: AnyColumn): SQL {
  // and() con todos los args definidos nunca devuelve undefined.
  return and(isNotNull(lat), isNotNull(lng), sql`${lat} <> 0`, sql`${lng} <> 0`) as SQL;
}
