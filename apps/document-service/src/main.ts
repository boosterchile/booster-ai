import http from 'node:http';
import { createLogger } from '@booster-ai/logger';
import { createPdfTedIngestor } from '@booster-ai/transport-documents';
import { type Message, PubSub, type Subscription } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import { createDrizzleDocumentStore } from './document-store.js';
import { createGcsDownloader } from './gcs-downloader.js';
import {
  documentUploadedMessageSchema,
  processDocumentUploaded,
} from './process-document-uploaded.js';

/**
 * document-service: worker Cloud Run que consume `document.uploaded` (frente
 * F4-4b). Por cada documento subido en 4a:
 *
 *   - Zod safeParse del payload → si falla, ack (descarta, no reintenta).
 *   - claim condicional por estado (idempotencia) → descarga GCS → decode TED
 *     (`@booster-ai/transport-documents`) → persiste `decodificado`/`fallido`.
 *   - ack si procesó (o skip idempotente); nack si error transitorio (GCS/DB)
 *     → reintento → DLQ tras `max_delivery_attempts` (messaging.tf, =5).
 *
 * El worker NO emite DTE ni toca el SII (ADR-069); solo extrae el <DD> del TED
 * y lo archiva. No borra ni reescribe el objeto GCS original (O-3, retención).
 *
 * Health probe HTTP /health para Cloud Run liveness.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/document-service',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  logger.info(
    {
      project: config.GOOGLE_CLOUD_PROJECT,
      subscription: config.PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED,
      bucket: config.DOCUMENTS_BUCKET,
      maxInFlight: config.MAX_MESSAGES_IN_FLIGHT,
    },
    'document-service (worker TED) starting',
  );

  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  const db = drizzle(pool);

  const store = createDrizzleDocumentStore({ db, logger });
  const downloader = createGcsDownloader({
    bucket: config.DOCUMENTS_BUCKET,
    projectId: config.GOOGLE_CLOUD_PROJECT,
  });
  const ingestor = createPdfTedIngestor();

  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
  const subscription: Subscription = pubsub.subscription(
    config.PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED,
    { flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT } },
  );

  const messageHandler = async (message: Message): Promise<void> => {
    const start = Date.now();
    try {
      const body = JSON.parse(message.data.toString('utf-8'));
      const parsed = documentUploadedMessageSchema.safeParse(body);
      if (!parsed.success) {
        logger.error(
          {
            messageId: message.id,
            errors: parsed.error.issues,
            bodyPreview: message.data.toString('utf-8').slice(0, 200),
          },
          'document.uploaded malformado, ack para descartar (no reintentar)',
        );
        message.ack();
        return;
      }

      const outcome = await processDocumentUploaded({
        message: parsed.data,
        store,
        downloader,
        ingestor,
      });

      message.ack();
      logger.info(
        {
          messageId: message.id,
          documentId: parsed.data.documentId,
          viajeId: parsed.data.viajeId,
          outcome,
          latencyMs: Date.now() - start,
        },
        'document.uploaded procesado',
      );
    } catch (err) {
      // Error transitorio (GCS/DB): nack → reintento → DLQ tras 5 intentos.
      logger.error(
        { err, messageId: message.id },
        'error procesando document.uploaded, nack para reintento',
      );
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
      res.end(JSON.stringify({ status: 'ok', service: 'document-service' }));
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
  const bootstrapLogger = createLogger({
    service: '@booster-ai/document-service',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
