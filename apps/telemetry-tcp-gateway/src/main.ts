import net from 'node:net';
import { createLogger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import { handleConnection } from './connection-handler.js';
import { CrashTracePublisher, TelemetryPublisher } from './pubsub-publisher.js';

/**
 * Entry point del telemetry-tcp-gateway.
 *
 * Long-lived TCP server (NO sirve en Cloud Run — por eso GKE Autopilot).
 * Una conexión por device Teltonika. Por device:
 *   1. Handshake IMEI → resolución vehiculo / dispositivos_pendientes.
 *   2. Loop de AVL packets → publish a Pub/Sub `telemetry-events`.
 *   3. ACK BE 4B record count para que el device libere su buffer.
 *
 * Graceful shutdown: SIGTERM → cerrar listening port + esperar
 * conexiones existentes a que terminen (con timeout) + flush Pub/Sub.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/telemetry-tcp-gateway',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  logger.info(
    {
      port: config.PORT,
      project: config.GOOGLE_CLOUD_PROJECT,
      topic: config.PUBSUB_TOPIC_TELEMETRY,
    },
    'telemetry-tcp-gateway starting',
  );

  // Postgres pool (compartido entre conexiones).
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);

  // Pub/Sub client (singleton).
  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
  const publisher = new TelemetryPublisher(pubsub, config.PUBSUB_TOPIC_TELEMETRY, logger);
  const crashPublisher = config.PUBSUB_TOPIC_CRASH_TRACES
    ? new CrashTracePublisher(pubsub, config.PUBSUB_TOPIC_CRASH_TRACES, logger)
    : null;

  if (!crashPublisher) {
    logger.warn('PUBSUB_TOPIC_CRASH_TRACES no configurado — Crash Trace publish DESHABILITADO');
  }

  const server = net.createServer((socket) => {
    handleConnection(socket, {
      db,
      publisher,
      crashPublisher,
      logger,
      idleTimeoutSec: config.IDLE_TIMEOUT_SEC,
    });
  });

  server.on('error', (err) => {
    logger.error({ err }, 'server error');
  });

  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'listening for Teltonika TCP connections');
  });

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'error closing server');
      }
      try {
        await publisher.flush();
        logger.info('publisher flushed');
      } catch (e) {
        logger.error({ err: e }, 'error flushing publisher');
      }
      try {
        await pool.end();
        logger.info('pg pool closed');
      } catch (e) {
        logger.error({ err: e }, 'error closing pg pool');
      }
      process.exit(0);
    });

    // Hard kill después de 30s si las conexiones no cierran.
    setTimeout(() => {
      logger.warn('shutdown timeout, forcing exit');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
