/**
 * eco-routing-service: orquestador de sugerencias de ruta ecológica en tiempo real.
 *
 * Consume posiciones de conductores desde Pub/Sub (driver-positions +
 * telemetry-events), mantiene estado por viaje (TripStateStore), y en cada
 * update significativo orquesta la evaluación de ruta alternativa con menor
 * emisión (Tasks 6+).
 *
 * Este task (Task 5) cubre el scaffold + store + consumer + baseline ETA.
 * La lógica de evaluación (traffic-condition-detector + route-alternatives-evaluator)
 * se conecta en Task 6.
 *
 * Health probe HTTP /health para Cloud Run liveness.
 */

import http from 'node:http';
import { createLogger } from '@booster-ai/logger';
import { PubSub, type Subscription } from '@google-cloud/pubsub';
import { loadConfig } from './config.js';
import { createPositionConsumer } from './position-consumer.js';
import { createInMemoryTripStateStore } from './trip-state-store.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/eco-routing-service',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  logger.info(
    {
      project: config.GOOGLE_CLOUD_PROJECT,
      driverPositionsSub: config.PUBSUB_SUBSCRIPTION_DRIVER_POSITIONS,
      telemetryEventsSub: config.PUBSUB_SUBSCRIPTION_TELEMETRY_EVENTS,
      maxInFlight: config.MAX_MESSAGES_IN_FLIGHT,
      cooldownSegundos: config.SUGGESTION_COOLDOWN_SEGUNDOS,
      evaluationDebounceMs: config.EVALUATION_DEBOUNCE_MS,
    },
    'eco-routing-service starting',
  );

  // -------------------------------------------------------------------------
  // Store de estado por viaje (in-memory con TTL — ver trip-state-store.ts
  // para la justificación Redis vs in-memory)
  // -------------------------------------------------------------------------

  const store = createInMemoryTripStateStore({ ttlMs: 4 * 60 * 60 * 1000 }); // TTL 4h

  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });

  // -------------------------------------------------------------------------
  // CONSUMER 1: driver-positions (posiciones desde el PWA del conductor)
  // -------------------------------------------------------------------------

  const driverPositionsSub: Subscription = pubsub.subscription(
    config.PUBSUB_SUBSCRIPTION_DRIVER_POSITIONS,
    { flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT } },
  );

  const driverPositionsConsumer = createPositionConsumer({
    store,
    logger,
    projectId: config.GOOGLE_CLOUD_PROJECT,
    source: 'driver-positions',
    evaluationDebounceMs: config.EVALUATION_DEBOUNCE_MS,
  });

  driverPositionsSub.on('message', (m) => void driverPositionsConsumer.handleMessage(m));
  driverPositionsSub.on('error', (err) => {
    logger.error(
      { err, subscription: config.PUBSUB_SUBSCRIPTION_DRIVER_POSITIONS },
      'subscription error driver-positions',
    );
  });

  // -------------------------------------------------------------------------
  // CONSUMER 2: telemetry-events (posiciones Teltonika vía pipeline existente)
  // -------------------------------------------------------------------------

  const telemetryEventsSub: Subscription = pubsub.subscription(
    config.PUBSUB_SUBSCRIPTION_TELEMETRY_EVENTS,
    { flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT } },
  );

  const telemetryEventsConsumer = createPositionConsumer({
    store,
    logger,
    projectId: config.GOOGLE_CLOUD_PROJECT,
    source: 'telemetry-events',
    evaluationDebounceMs: config.EVALUATION_DEBOUNCE_MS,
  });

  telemetryEventsSub.on('message', (m) => void telemetryEventsConsumer.handleMessage(m));
  telemetryEventsSub.on('error', (err) => {
    logger.error(
      { err, subscription: config.PUBSUB_SUBSCRIPTION_TELEMETRY_EVENTS },
      'subscription error telemetry-events',
    );
  });

  // -------------------------------------------------------------------------
  // Health probe HTTP
  // -------------------------------------------------------------------------

  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'eco-routing-service' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  healthServer.listen(config.HEALTH_PORT, () => {
    logger.info({ port: config.HEALTH_PORT }, 'health probe listening');
  });

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    for (const [sub, name] of [
      [driverPositionsSub, 'driver-positions'] as const,
      [telemetryEventsSub, 'telemetry-events'] as const,
    ]) {
      try {
        await sub.close();
        logger.info({ subscription: name }, 'subscription closed');
      } catch (e) {
        logger.error({ err: e, subscription: name }, 'error closing subscription');
      }
    }
    healthServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  const bootstrapLogger = createLogger({
    service: '@booster-ai/eco-routing-service',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
