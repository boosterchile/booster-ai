/**
 * position-consumer: Pub/Sub consumer de posiciones de conductores.
 *
 * Soporta dos fuentes:
 *   - 'driver-positions': posiciones del PWA del conductor (Task 4)
 *   - 'telemetry-events': posiciones Teltonika vía pipeline existente
 *
 * Para ambas, el payload canónico es `DriverPositionEvent` (driverPositionEventSchema).
 *
 * Por cada mensaje válido:
 * 1. Valida con Zod (driverPositionEventSchema).
 * 2. Actualiza el store (setPosicion).
 * 3. Si es la primera posición del viaje (no hay baseline ETA): calcula
 *    el baseline vía computeRoutes (best-effort: si falla, log + skip).
 * 4. Hace ack. (nack solo en errores transitorios de infraestructura).
 *
 * Mensajes inválidos (JSON mal formado o Zod rechaza): ack para descartar
 * (no reintentar) + log.error con contexto. NO se hace nack — los mensajes
 * malformados no se van a corregir solos, y reintentar llenaría el DLQ.
 *
 * Throttle / debounce de evaluación:
 * La evaluación completa (Task 6: traffic-condition-detector + route-alternatives-evaluator)
 * se dispara con debounce configurable por viaje. En Task 5 solo se
 * actualiza el store; el debounce está en la firma para que Task 6 lo conecte.
 *
 * Best-effort: ningún catch propaga — el consumer nunca muere por un error
 * de negocio. Solo hace nack si hay falla de infraestructura (no esperado
 * en este path).
 */

import type { Logger } from '@booster-ai/logger';
import { computeRoutes } from '@booster-ai/routes-api-client';
import { driverPositionEventSchema } from '@booster-ai/shared-schemas';
import type { Message } from '@google-cloud/pubsub';
import type { TripStateStore } from './trip-state-store.js';

export interface PositionConsumerOptions {
  store: TripStateStore;
  logger: Logger;
  projectId: string;
  /** Fuente de la posición (para logs y contexto). */
  source: 'driver-positions' | 'telemetry-events';
  /**
   * Debounce en ms para la evaluación de alternativas (Task 6).
   * 0 = sin debounce (útil en tests).
   */
  evaluationDebounceMs: number;
}

export interface PositionConsumer {
  handleMessage(message: Message): Promise<void>;
}

/**
 * Crea un consumer de posiciones inyectable y testeable.
 * No sabe de Pub/Sub subscriptions — recibe mensajes individualmente.
 */
export function createPositionConsumer(opts: PositionConsumerOptions): PositionConsumer {
  const { store, logger, projectId, source, evaluationDebounceMs: _evaluationDebounceMs } = opts;

  // Debounce map por viajeId (Task 6 conectará la evaluación aquí)
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  return {
    async handleMessage(message: Message): Promise<void> {
      const messageId = message.id;
      const start = Date.now();

      // ------------------------------------------------------------------
      // 1. Parse JSON
      // ------------------------------------------------------------------
      let body: unknown;
      try {
        body = JSON.parse(message.data.toString('utf-8'));
      } catch (err) {
        logger.error(
          {
            err,
            messageId,
            source,
            bodyPreview: message.data.toString('utf-8').slice(0, 200),
          },
          'posicion mensaje: JSON invalido, ack para descartar (no reintentar)',
        );
        message.ack();
        return;
      }

      // ------------------------------------------------------------------
      // 2. Validar con Zod (driverPositionEventSchema)
      // ------------------------------------------------------------------
      const parsed = driverPositionEventSchema.safeParse(body);
      if (!parsed.success) {
        logger.error(
          {
            messageId,
            source,
            zodErrors: parsed.error.issues,
            bodyPreview: JSON.stringify(body).slice(0, 200),
          },
          'posicion mensaje: Zod invalido, ack para descartar',
        );
        message.ack();
        return;
      }

      const event = parsed.data;
      const { viajeId, lat, lng, registradoEn } = event;

      // ------------------------------------------------------------------
      // 3. Actualizar store
      // ------------------------------------------------------------------
      store.setPosicion(viajeId, { lat, lng, registradoEn });

      // ------------------------------------------------------------------
      // 4. Baseline ETA: solo si no hay baseline para este viaje
      // ------------------------------------------------------------------
      const estadoActual = store.getEstado(viajeId);
      const necesitaBaseline =
        estadoActual?.etaBaselineSegundos === null ||
        estadoActual?.etaBaselineSegundos === undefined;

      if (necesitaBaseline) {
        await computeBaselineEta({ viajeId, projectId, store, logger });
      }

      // ------------------------------------------------------------------
      // 5. Trigger evaluación (Task 6 lo conectará aquí con debounce)
      // ------------------------------------------------------------------
      triggerEvaluation({
        viajeId,
        debounceTimers,
        evaluationDebounceMs: _evaluationDebounceMs,
        logger,
      });

      // ------------------------------------------------------------------
      // 6. Ack
      // ------------------------------------------------------------------
      message.ack();

      logger.info(
        {
          messageId,
          source,
          viajeId,
          vehiculoId: event.vehiculoId,
          lat,
          lng,
          latencyMs: Date.now() - start,
          tuvBaseline: !necesitaBaseline,
        },
        'posicion procesada',
      );
    },
  };
}

/**
 * Calcula el baseline ETA para un viaje usando computeRoutes.
 *
 * Best-effort: si computeRoutes falla (timeout, quota, error de red),
 * logueamos y retornamos sin crash. El baseline se intentará de nuevo
 * en el próximo mensaje de posición del mismo viaje.
 *
 * La ruta planificada se obtiene de `ecoRoutePolylineEncoded` en el trip
 * (persiste desde la pre-aceptación). En Task 5 usamos origen=posición
 * actual y destino=... Nota: el eco-routing-service no tiene acceso
 * directo a la DB. Por diseño (arquitectura B: servicio event-driven),
 * el baseline se calcula usando origin/destination del Pub/Sub mensaje o
 * de un evento previo.
 *
 * Simplificación Task 5: el baseline se pide con la posición actual
 * como origen y un placeholder de destino. Task 6 o una migración de
 * datos conectará el destination real del trip. Esto es deuda declarada.
 *
 * TODO (Task 6): conectar con el trip route real.
 *   - Opción A: incluir `destinoLat/destinoLng` en el DriverPositionEvent
 *     (requiere cambio en el publisher).
 *   - Opción B: el servicio tiene un cliente DB read-only para lookups de
 *     trip metadata.
 *   - Decision: documentada aquí para Task 6.
 */
async function computeBaselineEta(opts: {
  viajeId: string;
  projectId: string;
  store: TripStateStore;
  logger: Logger;
}): Promise<void> {
  const { viajeId, projectId, store, logger } = opts;
  const estado = store.getEstado(viajeId);
  if (!estado?.posicionActual) {
    return;
  }

  const { lat, lng } = estado.posicionActual;
  const origin = `${lat},${lng}`;

  try {
    const routes = await computeRoutes({
      projectId,
      // Origin: posición actual del conductor
      origin,
      // Destination: placeholder — Task 6 conecta el destino real del trip.
      // Por ahora usamos el mismo origen para que Routes API retorne algo
      // (duración ≈ 0). Esto es deuda declarada: no bloquea el servicio
      // pero el baseline no es útil hasta que Task 6 conecte el destino real.
      destination: origin,
      computeAlternatives: false,
      logger,
    });

    if (!routes || routes.length === 0) {
      logger.warn({ viajeId, origin }, 'baseline ETA: Routes API no retorno rutas, skip baseline');
      return;
    }

    const baselineRoute = routes[0];
    if (!baselineRoute) {
      return;
    }

    store.setBaseline(viajeId, baselineRoute.durationS);
    logger.info(
      { viajeId, etaBaselineSegundos: baselineRoute.durationS, origin },
      'baseline ETA computado',
    );
  } catch (err) {
    logger.error({ err, viajeId, origin }, 'baseline ETA: computeRoutes fallo, skip (best-effort)');
    // No re-throw: best-effort, el servicio no crashea
  }
}

/**
 * Trigger de evaluación con debounce por viaje.
 *
 * En Task 5 este es solo el stub. Task 6 reemplazará el body de la
 * función con la lógica de evaluación real (traffic-condition-detector
 * → route-alternatives-evaluator → sugerencia).
 */
function triggerEvaluation(opts: {
  viajeId: string;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  evaluationDebounceMs: number;
  logger: Logger;
}): void {
  const { viajeId, debounceTimers, evaluationDebounceMs, logger } = opts;

  // Cancelar el timer anterior para este viaje (debounce)
  const existing = debounceTimers.get(viajeId);
  if (existing) {
    clearTimeout(existing);
  }

  if (evaluationDebounceMs <= 0) {
    // Sin debounce: ejecutar inmediatamente (en tests)
    logger.debug({ viajeId }, 'evaluacion eco-routing: stub Task 5 (Task 6 conecta la logica)');
    return;
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(viajeId);
    logger.debug({ viajeId }, 'evaluacion eco-routing: stub Task 5 (Task 6 conecta la logica)');
    // Task 6: aquí va la llamada a traffic-condition-detector + evaluateAlternatives
  }, evaluationDebounceMs);

  debounceTimers.set(viajeId, timer);
}
