import http from 'node:http';
import { createLogger } from '@booster-ai/logger';
import { type Message, PubSub, type Subscription } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import { persistRecord, recordMessageSchema } from './persist.js';

/**
 * telemetry-processor: consumer Pub/Sub que persiste los AVL records
 * publicados por telemetry-tcp-gateway en `telemetria_puntos`.
 *
 * Diseño:
 *   - Pull subscription con flow control (max in-flight ajustable).
 *   - Por mensaje: zod parse → persistRecord → ack o nack.
 *   - ack inmediato si valida OK e insertó (o si dedupó por UNIQUE).
 *   - nack si error de DB transitorio (Pub/Sub reintenta automático).
 *   - ack + log si validación falla (mensaje malformado del gateway —
 *     no queremos infinite retry; mejor descartar + alertar).
 *
 * Health probe HTTP en /health para Cloud Run liveness.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/telemetry-processor',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  logger.info(
    {
      project: config.GOOGLE_CLOUD_PROJECT,
      subscription: config.PUBSUB_SUBSCRIPTION_TELEMETRY,
      maxInFlight: config.MAX_MESSAGES_IN_FLIGHT,
    },
    'telemetry-processor starting',
  );

  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);

  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
  const subscription: Subscription = pubsub.subscription(config.PUBSUB_SUBSCRIPTION_TELEMETRY, {
    flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT },
  });

  const messageHandler = async (message: Message): Promise<void> => {
    const start = Date.now();
    try {
      const body = JSON.parse(message.data.toString('utf-8'));
      const parsed = recordMessageSchema.safeParse(body);
      if (!parsed.success) {
        logger.error(
          {
            messageId: message.id,
            errors: parsed.error.issues,
            bodyPreview: message.data.toString('utf-8').slice(0, 200),
          },
          'mensaje pubsub malformado, ack para descartar (no reintentar)',
        );
        message.ack();
        return;
      }

      const result = await persistRecord({ db, logger, msg: parsed.data });
      message.ack();

      logger.info(
        {
          messageId: message.id,
          imei: parsed.data.imei,
          vehicleId: parsed.data.vehicleId,
          inserted: result.inserted,
          isFirstPointForVehicle: result.isFirstPointForVehicle,
          latencyMs: Date.now() - start,
        },
        result.inserted ? 'record persistido' : 'record duplicado (skip)',
      );

      if (result.isFirstPointForVehicle) {
        logger.info(
          { vehicleId: parsed.data.vehicleId, imei: parsed.data.imei },
          'PRIMER punto de telemetría para este vehículo (TODO: insert evento_viaje telemetria_primera_recibida)',
        );
      }
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'error procesando, nack para reintento');
      message.nack();
    }
  };

  subscription.on('message', (m) => void messageHandler(m));
  subscription.on('error', (err) => {
    logger.error({ err }, 'subscription error');
  });

  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'telemetry-processor' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  healthServer.listen(config.HEALTH_PORT, () => {
    logger.info({ port: config.HEALTH_PORT }, 'health probe listening');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    try {
      await subscription.close();
      logger.info('subscription closed');
    } catch (e) {
      logger.error({ err: e }, 'error closing subscription');
    }
    healthServer.close();
    try {
      await pool.end();
      logger.info('pg pool closed');
    } catch (e) {
      logger.error({ err: e }, 'error closing pg pool');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
