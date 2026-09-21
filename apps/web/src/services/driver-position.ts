import { api } from '../lib/api-client.js';

/**
 * D2 — Cliente del endpoint `POST /assignments/:id/driver-position`.
 *
 * Usado por el hook `useDriverPositionReporter` en el flujo del dashboard
 * del conductor (`/app/conductor`):
 *   - El driver toca "Iniciar reporte GPS" en /app/conductor cuando opera
 *     un vehículo SIN Teltonika (el botón está inline en cada
 *     assignment card).
 *   - `navigator.geolocation.watchPosition` dispara cada ~10s.
 *   - Cada disparo llama a esta función con la posición.
 *   - El backend persiste en `posiciones_movil_conductor` y los read
 *     endpoints (`/vehiculos/flota`, `/:id/ubicacion`) la sirven al
 *     carrier.
 */

export interface DriverPositionInput {
  /** ISO datetime de la captura GPS — del browser `position.timestamp`. */
  timestamp_device: string;
  latitude: number;
  longitude: number;
  /** Precisión en metros del browser (`coords.accuracy`). */
  accuracy_m?: number | null;
  /** Velocidad en km/h. El browser entrega m/s → convertir antes de llamar. */
  speed_kmh?: number | null;
  /** Rumbo (heading) en grados 0-360. */
  heading_deg?: number | null;
}

/**
 * Veredicto del geofence del origen que el API evalúa con cada posición
 * (T8/T9, medicion-huella-segmento). `sin_origen` = viaje sin geocodificar:
 * respuesta válida, no error — la recogida se dispara solo por tap.
 */
export type GeofenceEstado = 'dentro' | 'fuera' | 'sin_origen' | 'sin_posicion';

export interface DriverPositionResponse {
  ok: boolean;
  /** Ausente si el API aún no evalúa geofence (compat hacia atrás). */
  geofence?: { estado: GeofenceEstado; distancia_m: number | null };
}

export async function postDriverPosition(
  assignmentId: string,
  input: DriverPositionInput,
): Promise<DriverPositionResponse> {
  return await api.post<DriverPositionResponse>(
    `/assignments/${assignmentId}/driver-position`,
    input,
  );
}

/** Tope de `speed_kmh` en POST /assignments/:id/driver-position. */
export const SPEED_KMH_MAX = 300;
/** Tope de `heading_deg` en el mismo POST (0–360 inclusive). */
export const HEADING_DEG_MAX = 360;

/**
 * El API exige `accuracy_m` positivo o null (Zod `.positive().max(10_000)`).
 * `0` / NaN / no finito = precisión desconocida (Playwright y varios
 * dispositivos reportan 0), no un radio de 0 m: se manda `null`.
 */
export function normalizarAccuracyM(accuracy_m: number | null | undefined): number | null {
  if (accuracy_m == null || !Number.isFinite(accuracy_m) || accuracy_m <= 0) {
    return null;
  }
  return accuracy_m;
}

/**
 * Velocidad fuera de 0..300 km/h se manda `null`, no se rechaza el punto.
 * Varios WebView reportan `coords.speed = -1` cuando no hay velocidad: eso
 * es -3.6 km/h y el Zod `.min(0)` respondía 400 a TODO el body, así que la
 * coordenada nueva nunca se insertaba y el tracking se quedaba en el último
 * ping válido (BOO-83ND2C).
 */
export function normalizarSpeedKmh(speed_kmh: number | null | undefined): number | null {
  if (
    speed_kmh == null ||
    !Number.isFinite(speed_kmh) ||
    speed_kmh < 0 ||
    speed_kmh > SPEED_KMH_MAX
  ) {
    return null;
  }
  return Math.round(speed_kmh * 100) / 100;
}

/** Rumbo fuera de 0..360 (p. ej. heading -1) → `null`. Misma razón que la velocidad. */
export function normalizarHeadingDeg(heading_deg: number | null | undefined): number | null {
  if (
    heading_deg == null ||
    !Number.isFinite(heading_deg) ||
    heading_deg < 0 ||
    heading_deg > HEADING_DEG_MAX
  ) {
    return null;
  }
  return Math.round(heading_deg);
}

/**
 * Convierte una `GeolocationPosition` del browser al body que espera el API.
 * Convierte speed m/s → km/h (el browser usa SI; el API español usa km/h).
 */
export function geoPositionToBody(pos: GeolocationPosition): DriverPositionInput {
  const speedMs = pos.coords.speed;
  return {
    timestamp_device: new Date(pos.timestamp).toISOString(),
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy_m: normalizarAccuracyM(pos.coords.accuracy),
    speed_kmh: normalizarSpeedKmh(speedMs == null ? null : speedMs * 3.6),
    heading_deg: normalizarHeadingDeg(pos.coords.heading),
  };
}
