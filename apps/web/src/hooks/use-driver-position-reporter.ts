import { useEffect, useRef, useState } from 'react';
import {
  type GeofenceEstado,
  geoPositionToBody,
  postDriverPosition,
} from '../services/driver-position.js';

/**
 * D2 — Hook que activa `navigator.geolocation.watchPosition` y postea la
 * posición al backend cada vez que el browser entrega una nueva. Pensado
 * para conductores cuyo vehículo NO tiene Teltonika asociado.
 *
 * Estados expuestos:
 *   - `isWatching`: true mientras el watchPosition está activo.
 *   - `lastPosition`: última posición capturada (para debug/UI feedback).
 *   - `lastError`: último error de geolocation o de POST (null si todo OK).
 *   - `pointsSent`: contador de POSTs exitosos.
 *   - `lastGeofence`: última lectura del geofence del origen que devolvió el
 *     API para una posición (T9, medicion-huella-segmento), con el timestamp
 *     de ESA posición — el instante del cruce que viaja como `picked_up_at`.
 *     Null hasta la primera respuesta con veredicto; se limpia al `start`.
 *
 * Métodos:
 *   - `start(assignmentId)`: activa watchPosition para el assignment dado.
 *   - `stop()`: detiene el watcher y limpia estado.
 *
 * El hook no maneja permission prompts — eso vive en
 * `services/driver-mode-permissions.ts`. Si el browser deniega geolocation,
 * `start` setea `lastError` y `isWatching=false`.
 */
/** Veredicto del geofence del origen para una posición reportada. */
export interface GeofenceLectura {
  estado: GeofenceEstado;
  distanciaM: number | null;
  /** ISO del `timestamp_device` de la posición que produjo esta lectura. */
  at: string;
}

export interface UseDriverPositionReporterResult {
  isWatching: boolean;
  lastPosition: { latitude: number; longitude: number; timestamp: string } | null;
  lastError: string | null;
  pointsSent: number;
  lastGeofence: GeofenceLectura | null;
  start: (assignmentId: string) => void;
  stop: () => void;
}

export function useDriverPositionReporter(): UseDriverPositionReporterResult {
  const [isWatching, setIsWatching] = useState(false);
  const [lastPosition, setLastPosition] =
    useState<UseDriverPositionReporterResult['lastPosition']>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pointsSent, setPointsSent] = useState(0);
  const [lastGeofence, setLastGeofence] = useState<GeofenceLectura | null>(null);
  const watcherIdRef = useRef<number | null>(null);

  // Cleanup en unmount.
  useEffect(() => {
    return () => {
      if (watcherIdRef.current != null) {
        navigator.geolocation.clearWatch(watcherIdRef.current);
        watcherIdRef.current = null;
      }
    };
  }, []);

  function start(assignmentId: string): void {
    if (watcherIdRef.current != null) {
      // Ya está corriendo. Idempotente.
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLastError('Geolocation no disponible en este navegador.');
      return;
    }
    setLastError(null);
    setLastGeofence(null);
    setIsWatching(true);

    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const body = geoPositionToBody(pos);
        setLastPosition({
          latitude: body.latitude,
          longitude: body.longitude,
          timestamp: body.timestamp_device,
        });
        postDriverPosition(assignmentId, body)
          .then((res) => {
            setPointsSent((n) => n + 1);
            setLastError(null);
            if (res.geofence) {
              setLastGeofence({
                estado: res.geofence.estado,
                distanciaM: res.geofence.distancia_m,
                at: body.timestamp_device,
              });
            }
          })
          .catch((err: Error) => {
            setLastError(`Error al reportar posición: ${err.message}`);
          });
      },
      (err) => {
        setLastError(`Geolocation error: ${err.message}`);
      },
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 5_000,
      },
    );
    watcherIdRef.current = id;
  }

  function stop(): void {
    if (watcherIdRef.current != null) {
      navigator.geolocation.clearWatch(watcherIdRef.current);
      watcherIdRef.current = null;
    }
    setIsWatching(false);
  }

  return { isWatching, lastPosition, lastError, pointsSent, lastGeofence, start, stop };
}
