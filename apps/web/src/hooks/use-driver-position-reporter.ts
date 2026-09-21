/**
 * Hook del reporte de posición del móvil del conductor. Desde el Slot 3 (GPS
 * resiliente) es una vista de `services/driver-position-reporter.ts`: UN solo
 * watcher por sesión, throttle por tiempo y distancia, latido con el camión
 * detenido y cola offline persistida con reintento. Ver la spec en
 * `.specs/conductor-gps-resiliente/`.
 *
 * Resultado (misma forma que antes, más `queued` y `flush`):
 *   - `isWatching`, `lastPosition`, `lastError`, `pointsSent`, `lastGeofence`.
 *   - `queued`: posiciones esperando señal.
 *   - `start(assignmentId)` idempotente; `stop()`; `flush()` drena la cola
 *     (la tarjeta lo llama antes de confirmar la entrega).
 *   - Mientras este hook está montado retiene el wake lock de pantalla, si
 *     el reporter observa. Al desmontar la última tarjeta se suelta. No
 *     para el watcher: salir de Conductor no corta el GPS del módulo.
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
  type GeofenceLectura,
  flush,
  getSnapshot,
  retainScreenWakeLock,
  start,
  stop,
  subscribe,
} from '../services/driver-position-reporter.js';

export type { GeofenceLectura };

export interface UseDriverPositionReporterResult {
  isWatching: boolean;
  lastPosition: { latitude: number; longitude: number; timestamp: string } | null;
  lastError: string | null;
  pointsSent: number;
  lastGeofence: GeofenceLectura | null;
  queued: number;
  enSegundoPlano: boolean;
  avisoPausa: boolean;
  start: (assignmentId: string) => void;
  stop: () => void;
  flush: () => Promise<{ enviados: number; restantes: number }>;
}

export function useDriverPositionReporter(): UseDriverPositionReporterResult {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => retainScreenWakeLock(), []);
  return {
    isWatching: snap.isWatching,
    lastPosition: snap.lastPosition,
    lastError: snap.lastError,
    pointsSent: snap.pointsSent,
    lastGeofence: snap.lastGeofence,
    queued: snap.queued,
    enSegundoPlano: snap.enSegundoPlano,
    avisoPausa: snap.avisoPausa,
    start,
    stop,
    flush: () => flush(),
  };
}
