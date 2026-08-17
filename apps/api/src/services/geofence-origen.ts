/**
 * Detector de geofence del origen del viaje (Task 8, plan
 * medicion-huella-segmento).
 *
 * Diseño:
 *   - Función pura, sin I/O ni acceso a config: recibe la posición del
 *     conductor, el origen geocodificado del viaje (T4) y el radio en metros,
 *     y decide si el conductor está dentro del geofence. El caller (T9) lee el
 *     radio de `config.GEOFENCE_RADIUS_M` (Zod, default 150 m) y lo pasa.
 *   - Distancia great-circle por haversine, reusando `haversineKm` de
 *     `calcular-cobertura-telemetria.ts` (misma fórmula, mismo radio
 *     terrestre 6371 km): un solo criterio geodésico en el codebase.
 *   - Borde INCLUSIVO: `distancia <= radio` cuenta como dentro. Un conductor
 *     detenido exactamente en el límite debe recibir la sugerencia.
 *   - "Origen sin geocodificar" es un CASO DE PRIMERA CLASE, no un error:
 *     `geocodificarOrigen` degrada a NULL en siete escenarios (sin GCP,
 *     timeout/cuota/red, ruta vacía, sin startLocation, coordenadas inválidas,
 *     error inesperado) y los viajes anteriores a la migración 0054 también
 *     quedan en NULL. Con `origen: null` (o coordenadas inválidas) la respuesta
 *     es `{ estado: 'sin_origen' }`: no hay geofence y la recogida se dispara
 *     solo por tap. Jamás lanza ni asume coordenadas.
 *   - Simétrico para la posición del conductor: ausente o inválida →
 *     `{ estado: 'sin_posicion' }` (sin GPS/permiso → botón manual, T9).
 *   - Validez de coordenadas: `esCoordenadaGpsValida` (finitas y fuera del null
 *     island 0,0 — el sentinela de "sin fix"). Un 0,0 en cualquiera de los dos
 *     lados NO produce "fuera": produce "sin dato", que es lo que es.
 *   - `dentroDelGeofence` es el predicado booleano derivado (solo `dentro` es
 *     `true`); `evaluarGeofenceOrigen` da el estado completo para que la UI
 *     distinga "fuera" de "sin geofence disponible".
 *
 * Supuestos:
 *   - `radioM > 0` (lo garantiza el Zod de `GEOFENCE_RADIUS_M`:
 *     `int().positive()`); no se re-valida acá.
 *   - Coordenadas en grados decimales WGS84 (las que persiste T4 y las que
 *     entrega la Geolocation API del navegador). Precisión haversine (<0.5 %)
 *     sobra para radios de decenas a cientos de metros.
 */

import { haversineKm } from './calcular-cobertura-telemetria.js';
import { esCoordenadaGpsValida } from './coordenada-gps.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface EvaluarGeofenceOrigenInput {
  /** Posición actual del conductor; null si no hay GPS/permiso. */
  pos: LatLng | null;
  /** Origen geocodificado del viaje (`trips.origin_latitude/longitude`); null si no se geocodificó. */
  origen: LatLng | null;
  /** Radio del geofence en metros (`config.GEOFENCE_RADIUS_M`). */
  radioM: number;
}

export type ResultadoGeofenceOrigen =
  | { estado: 'dentro'; distanciaM: number }
  | { estado: 'fuera'; distanciaM: number }
  /** Viaje sin origen geocodificado (o coordenadas inválidas): sin geofence, disparo solo por tap. */
  | { estado: 'sin_origen' }
  /** Sin posición del conductor (o inválida): no se puede evaluar. */
  | { estado: 'sin_posicion' };

export function evaluarGeofenceOrigen(input: EvaluarGeofenceOrigenInput): ResultadoGeofenceOrigen {
  const { pos, origen, radioM } = input;

  if (!origen || !esCoordenadaGpsValida(origen.lat, origen.lng)) {
    return { estado: 'sin_origen' };
  }
  if (!pos || !esCoordenadaGpsValida(pos.lat, pos.lng)) {
    return { estado: 'sin_posicion' };
  }

  const distanciaM = haversineKm(origen.lat, origen.lng, pos.lat, pos.lng) * 1000;
  return distanciaM <= radioM ? { estado: 'dentro', distanciaM } : { estado: 'fuera', distanciaM };
}

/** `true` solo cuando el conductor está dentro del radio; `false` en fuera / sin_origen / sin_posicion. */
export function dentroDelGeofence(input: EvaluarGeofenceOrigenInput): boolean {
  return evaluarGeofenceOrigen(input).estado === 'dentro';
}
