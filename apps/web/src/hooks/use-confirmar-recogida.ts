import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api-client.js';
import type { GeofenceLectura } from './use-driver-position-reporter.js';

/**
 * Disparo híbrido de la recogida (Task 9, plan medicion-huella-segmento).
 *
 * Diseño:
 *   - El geofence del origen (evaluado en el API con cada posición reportada,
 *     T8) SUGIERE la recogida; el conductor la confirma con un tap. La UI
 *     nunca la dispara sola: un camión que pasa por la puerta no "recogió".
 *   - `enteredAt` = timestamp de la PRIMERA posición cuya lectura fue
 *     `dentro`. Es el instante del cruce y viaja como `picked_up_at` al
 *     confirmar; el servidor lo acota (ni futuro ni anterior a la aceptación).
 *     No se reescribe si el GPS sale y vuelve a entrar (jitter urbano): la
 *     sugerencia tampoco parpadea.
 *   - Sin cruce (origen sin geocodificar → `sin_origen`, sin GPS/permiso, o
 *     nunca entró) el tap manual sigue disponible y se manda SIN body: el
 *     servidor pone `now`. La recogida NUNCA se bloquea por falta de señal
 *     (degradación corte #1 del spec).
 *   - Los mensajes de error no culpan a la señal cuando el backend contestó
 *     (`ApiError`); solo la caída de red lo hace.
 *
 * `confirmar()` no pide confirmación al usuario: eso es de la pantalla
 * (`window.confirm` en la card), para que un toque accidental no la dispare.
 */

export interface UseConfirmarRecogidaOptions {
  assignmentId: string;
  /** `assignment.status === 'recogido'` al montar. */
  initialRecogida: boolean;
  /** Última lectura del geofence del reporter GPS (null si no hay). */
  geofence: GeofenceLectura | null;
}

export interface UseConfirmarRecogidaResult {
  recogida: boolean;
  recogiendo: boolean;
  error: string | null;
  /** Hay cruce del geofence registrado y la recogida aún no se confirmó. */
  sugerida: boolean;
  /** ISO del instante del cruce (primera lectura `dentro`); null si no hubo. */
  enteredAt: string | null;
  confirmar: () => Promise<void>;
}

/**
 * Traduce el fallo de `PATCH /assignments/:id/confirmar-recogida`.
 *
 * Si el backend contestó, culpar a la señal sería mentira.
 */
export function mensajeDeRecogida(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_status':
        return 'Este viaje ya no está esperando la carga. Actualiza la lista para ver cómo quedó.';
      case 'forbidden':
        return 'Este viaje no está a tu nombre. Avísale a tu empresa.';
      case 'assignment_not_found':
        return 'No encontramos este viaje. Actualiza la lista.';
      case 'invalid_picked_up_at':
        return 'La hora de llegada registrada no es válida. Vuelve a intentar: se usará la hora actual.';
      default:
        return 'No pudimos registrar la recogida. Avísale a tu empresa.';
    }
  }
  return 'No pudimos registrar la recogida. Revisa tu señal e intenta de nuevo.';
}

export function useConfirmarRecogida(
  opts: UseConfirmarRecogidaOptions,
): UseConfirmarRecogidaResult {
  const { assignmentId, initialRecogida, geofence } = opts;
  const [recogida, setRecogida] = useState(initialRecogida);
  const [recogiendo, setRecogiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enteredAt, setEnteredAt] = useState<string | null>(null);

  // Primer cruce: se fija una sola vez.
  useEffect(() => {
    if (enteredAt === null && geofence?.estado === 'dentro') {
      setEnteredAt(geofence.at);
    }
  }, [geofence, enteredAt]);

  const confirmar = useCallback(async () => {
    setError(null);
    setRecogiendo(true);
    try {
      if (enteredAt) {
        await api.patch(`/assignments/${assignmentId}/confirmar-recogida`, {
          picked_up_at: enteredAt,
        });
      } else {
        await api.patch(`/assignments/${assignmentId}/confirmar-recogida`);
      }
      setRecogida(true);
    } catch (err) {
      setError(mensajeDeRecogida(err));
    } finally {
      setRecogiendo(false);
    }
  }, [assignmentId, enteredAt]);

  return {
    recogida,
    recogiendo,
    error,
    sugerida: !recogida && enteredAt !== null,
    enteredAt,
    confirmar,
  };
}
