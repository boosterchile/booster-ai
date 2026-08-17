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
    accuracy_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
    speed_kmh:
      speedMs != null && Number.isFinite(speedMs) ? Math.round(speedMs * 3.6 * 100) / 100 : null,
    heading_deg:
      pos.coords.heading != null && Number.isFinite(pos.coords.heading)
        ? Math.round(pos.coords.heading)
        : null,
  };
}
