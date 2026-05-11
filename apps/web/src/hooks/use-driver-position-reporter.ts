import { useEffect, useRef, useState } from 'react';
import { geoPositionToBody, postDriverPosition } from '../services/driver-position.js';

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
 *
 * Métodos:
 *   - `start(assignmentId)`: activa watchPosition para el assignment dado.
 *   - `stop()`: detiene el watcher y limpia estado.
 *
 * El hook no maneja permission prompts — eso vive en
 * `services/driver-mode-permissions.ts`. Si el browser deniega geolocation,
 * `start` setea `lastError` y `isWatching=false`.
 */
export interface UseDriverPositionReporterResult {
  isWatching: boolean;
  lastPosition: { latitude: number; longitude: number; timestamp: string } | null;
  lastError: string | null;
  pointsSent: number;
  start: (assignmentId: string) => void;
  stop: () => void;
}

export function useDriverPositionReporter(): UseDriverPositionReporterResult {
  const [isWatching, setIsWatching] = useState(false);
  const [lastPosition, setLastPosition] =
    useState<UseDriverPositionReporterResult['lastPosition']>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pointsSent, setPointsSent] = useState(0);
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
          .then(() => {
            setPointsSent((n) => n + 1);
            setLastError(null);
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

  return { isWatching, lastPosition, lastError, pointsSent, start, stop };
}
