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
 * 3. Lee tripData de DB (readTripData) — filtra viajes no en 'en_proceso'.
 * 4. Si es la primera posición del viaje (no hay baseline ETA): calcula
 *    el baseline vía computeRoutes con el destino real del trip (best-effort).
 * 5. Hace ack.
 *
 * Mensajes inválidos (JSON mal formado o Zod rechaza): ack para descartar
 * (no reintentar) + log.error con contexto. NO se hace nack — los mensajes
 * malformados no se van a corregir solos, y reintentar llenaría el DLQ.
 *
 * Throttle / debounce de evaluación:
 * La evaluación completa (traffic-condition-detector + route-alternatives-evaluator)
 * se dispara con debounce configurable por viaje.
 *
 * Best-effort: ningún catch propaga — el consumer nunca muere por un error
 * de negocio. Solo hace nack si hay falla de infraestructura (no esperado
 * en este path).
 */

import type { Logger } from '@booster-ai/logger';
import { computeRoutes } from '@booster-ai/routes-api-client';
import { driverPositionEventSchema } from '@booster-ai/shared-schemas';
import type { Message } from '@google-cloud/pubsub';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { evaluarReruteo } from './evaluar-reruteo.js';
import { type TripData, readTripData } from './trip-data-reader.js';
import type { TripStateStore } from './trip-state-store.js';

export interface PositionConsumerOptions {
  store: TripStateStore;
  db: NodePgDatabase<Record<string, unknown>>;
  logger: Logger;
  projectId: string;
  /** Fuente de la posición (para logs y contexto). */
  source: 'driver-positions' | 'telemetry-events';
  /**
   * Debounce en ms para la evaluación de alternativas.
   * 0 = sin debounce (útil en tests).
   */
  evaluationDebounceMs: number;
  /**
   * Cooldown mínimo entre sugerencias para el mismo viaje (segundos).
   */
  cooldownSegundos: number;
}

export interface PositionConsumer {
  handleMessage(message: Message): Promise<void>;
}

/**
 * Crea un consumer de posiciones inyectable y testeable.
 * No sabe de Pub/Sub subscriptions — recibe mensajes individualmente.
 */
export function createPositionConsumer(opts: PositionConsumerOptions): PositionConsumer {
  const {
    store,
    db,
    logger,
    projectId,
    source,
    evaluationDebounceMs: _evaluationDebounceMs,
    cooldownSegundos,
  } = opts;

  // Debounce map por viajeId
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
      // P2: Defense-in-depth: skip trips not in en_proceso state.
      // Task 4 publisher already gates on asignado/recogido (assignments.ts:447-449),
      // but we add this filter for defense-in-depth against any path that
      // bypasses the gate.
      // ------------------------------------------------------------------
      const tripData = await readTripData({ db, viajeId, logger });
      if (!tripData || tripData.estado !== 'en_proceso') {
        logger.debug(
          { viajeId, estado: tripData?.estado ?? 'no_data' },
          'posicion ignorada: viaje no en_proceso',
        );
        message.ack();
        return;
      }

      // ------------------------------------------------------------------
      // 4. Baseline ETA: solo si no hay baseline para este viaje
      // P1 fix: también tratar <= 0 como needs-recompute (poisoned placeholder).
      // ------------------------------------------------------------------
      const estadoActual = store.getEstado(viajeId);
      // Also treat <=0 as needs-recompute: a placeholder baseline (origin=dest →
      // ~0s) is poisoned and would cause traffic-condition-detector false positives.
      const necesitaBaseline =
        estadoActual?.etaBaselineSegundos === null ||
        estadoActual?.etaBaselineSegundos === undefined ||
        estadoActual.etaBaselineSegundos <= 0;

      if (necesitaBaseline) {
        await computeBaselineEta({ viajeId, projectId, store, logger, tripData });
      }

      // ------------------------------------------------------------------
      // 5. Trigger evaluación con debounce
      // ------------------------------------------------------------------
      triggerEvaluation({
        viajeId,
        debounceTimers,
        evaluationDebounceMs: _evaluationDebounceMs,
        logger,
        store,
        db,
        projectId,
        cooldownSegundos,
        tripData,
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
 * P1 fix (Task 6): usa el destino real del trip (tripData.destinoAddressRaw).
 * Si tripData es null o destinoAddressRaw está vacío, se skip el baseline.
 *
 * Best-effort: si computeRoutes falla (timeout, quota, error de red),
 * logueamos y retornamos sin crash. El baseline se intentará de nuevo
 * en el próximo mensaje de posición del mismo viaje.
 */
async function computeBaselineEta(opts: {
  viajeId: string;
  projectId: string;
  store: TripStateStore;
  logger: Logger;
  tripData: TripData | null;
}): Promise<void> {
  const { viajeId, projectId, store, logger, tripData } = opts;
  const estado = store.getEstado(viajeId);
  if (!estado?.posicionActual) {
    return;
  }

  // P1 fix: usar el destino real del trip
  if (!tripData?.destinoAddressRaw) {
    logger.warn({ viajeId }, 'baseline ETA: sin destino real en tripData, skip baseline');
    return;
  }

  const { lat, lng } = estado.posicionActual;
  const origin = `${lat},${lng}`;
  const destination = tripData.destinoAddressRaw;

  try {
    const routes = await computeRoutes({
      projectId,
      origin,
      destination,
      computeAlternatives: false,
      logger,
    });

    if (!routes || routes.length === 0) {
      logger.warn(
        { viajeId, origin, destination },
        'baseline ETA: Routes API no retorno rutas, skip baseline',
      );
      return;
    }

    const baselineRoute = routes[0];
    if (!baselineRoute) {
      return;
    }

    store.setBaseline(viajeId, baselineRoute.durationS);
    logger.info(
      { viajeId, etaBaselineSegundos: baselineRoute.durationS, origin, destination },
      'baseline ETA computado',
    );
  } catch (err) {
    logger.error(
      { err, viajeId, origin, destination },
      'baseline ETA: computeRoutes fallo, skip (best-effort)',
    );
    // No re-throw: best-effort, el servicio no crashea
  }
}

/**
 * Trigger de evaluación con debounce por viaje.
 *
 * Task 6: llama a evaluarReruteo con el tripData ya cargado.
 */
function triggerEvaluation(opts: {
  viajeId: string;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
  evaluationDebounceMs: number;
  logger: Logger;
  store: TripStateStore;
  db: NodePgDatabase<Record<string, unknown>>;
  projectId: string;
  cooldownSegundos: number;
  tripData: TripData;
}): void {
  const {
    viajeId,
    debounceTimers,
    evaluationDebounceMs,
    logger,
    store,
    db,
    projectId,
    cooldownSegundos,
    tripData,
  } = opts;

  // Cancelar el timer anterior para este viaje (debounce)
  const existing = debounceTimers.get(viajeId);
  if (existing) {
    clearTimeout(existing);
  }

  async function runEvaluation() {
    debounceTimers.delete(viajeId);
    try {
      await evaluarReruteo(viajeId, { store, db, projectId, cooldownSegundos, logger, tripData });
    } catch (err) {
      // Defensive: evaluarReruteo should never throw, but guard anyway
      logger.error(
        { err, viajeId },
        'triggerEvaluation: evaluarReruteo lanzó excepcion inesperada',
      );
    }
  }

  if (evaluationDebounceMs <= 0) {
    // Sin debounce: ejecutar inmediatamente (útil en tests)
    void runEvaluation();
    return;
  }

  const timer = setTimeout(() => void runEvaluation(), evaluationDebounceMs);
  debounceTimers.set(viajeId, timer);
}
