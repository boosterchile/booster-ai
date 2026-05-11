import { api } from '../lib/api-client.js';

/**
 * D2 — Cliente del endpoint `POST /assignments/:id/driver-position`.
 *
 * Usado por el hook `useDriverPositionReporter` en el flujo conductor-modo:
 *   - El driver activa "Reporte GPS móvil" en /app/conductor/modo cuando
 *     opera un vehículo SIN Teltonika.
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

export async function postDriverPosition(
  assignmentId: string,
  input: DriverPositionInput,
): Promise<{ ok: boolean }> {
  return await api.post<{ ok: boolean }>(`/assignments/${assignmentId}/driver-position`, input);
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
