import http from 'node:http';
import { createLogger } from '@booster-ai/logger';
import { createPdfTedIngestor } from '@booster-ai/transport-documents';
import { type Message, PubSub, type Subscription } from '@google-cloud/pubsub';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { createRegistrarEntrega } from './business-metrics.js';
import { loadConfig } from './config.js';
import { createDrizzleDocumentStore } from './document-store.js';
import { createGcsDownloader } from './gcs-downloader.js';
import { createDocumentUploadedHandler } from './handle-document-uploaded.js';
import { PUSH_PATH, createHttpHandler } from './http-server.js';
import { createPushTokenVerifier } from './push-auth.js';

/**
 * Cloud Run da 10 s entre SIGTERM y SIGKILL. Se espera a los mensajes en curso
 * (requests push y handlers pull) hasta este tope antes de cerrar el pool, para
 * no dejar una fila en `procesando` a mitad de decode. Si el tope se cumple, la
 * fila la libera el cron documentos-pendientes a los 30 min.
 */
const SHUTDOWN_DRAIN_MS = 8_000;

/** Espera `work` hasta `ms`; `true` si terminó a tiempo. */
function withinDeadline(work: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    work.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(true);
      },
    );
  });
}

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
 * Dos transportes (ADR-085), elegidos por `DOCUMENT_CONSUMER_MODE`:
 *
 *   - `pull`: StreamingPull dentro del container (`min_instances=1`, CPU
 *     siempre asignada).
 *   - `push`: Pub/Sub hace POST a `/pubsub/document-uploaded` y el servicio
 *     escala a cero.
 *
 * El HTTP (`/health` y el endpoint push) corre en los dos modos.
 *
 * El worker NO emite DTE ni toca el SII (ADR-069); solo extrae el <DD> del TED
 * y lo archiva. No borra ni reescribe el objeto GCS original (O-3, retención).
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
      mode: config.DOCUMENT_CONSUMER_MODE,
      pushEndpoint: config.PUSH_CALLER_SA === undefined ? null : PUSH_PATH,
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

  const registrarEntrega = createRegistrarEntrega();
  const handleMessage = createDocumentUploadedHandler({
    store: createDrizzleDocumentStore({ db, logger }),
    downloader: createGcsDownloader({
      bucket: config.DOCUMENTS_BUCKET,
      projectId: config.GOOGLE_CLOUD_PROJECT,
    }),
    ingestor: createPdfTedIngestor(),
    logger,
    registrarEntrega,
  });

  let subscription: Subscription | null = null;
  // `subscription.close()` no espera a los handlers en curso: se llevan acá.
  const pullInFlight = new Set<Promise<void>>();
  if (config.DOCUMENT_CONSUMER_MODE === 'pull') {
    const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
    const pullSubscription = pubsub.subscription(config.PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED, {
      flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT },
    });
    pullSubscription.on('message', (message: Message) => {
      const work = handleMessage({
        data: message.data,
        messageId: message.id,
        deliveryAttempt: message.deliveryAttempt,
        transporte: 'pull',
      })
        .then((decision) => (decision === 'ack' ? message.ack() : message.nack()))
        .catch((err: unknown) => {
          logger.error(
            { err, messageId: message.id },
            'error procesando document.uploaded, nack para reintento',
          );
          message.nack();
        })
        .finally(() => {
          pullInFlight.delete(work);
        });
      pullInFlight.add(work);
    });
    pullSubscription.on('error', (err) => {
      logger.error({ err }, 'subscription error');
    });
    subscription = pullSubscription;
  }

  // config.ts exige PUSH_CALLER_SA y PUSH_OIDC_AUDIENCE juntos.
  const pushAuth =
    config.PUSH_CALLER_SA !== undefined && config.PUSH_OIDC_AUDIENCE !== undefined
      ? { allowedCallerSa: config.PUSH_CALLER_SA, audience: config.PUSH_OIDC_AUDIENCE }
      : null;
  const server = http.createServer(
    createHttpHandler({
      logger,
      ...(pushAuth === null
        ? {}
        : {
            push: {
              verifyToken: createPushTokenVerifier({ ...pushAuth, logger }),
              handleMessage,
              registrarEntrega,
            },
          }),
    }),
  );
  server.listen(config.HEALTH_PORT, () => {
    logger.info({ port: config.HEALTH_PORT }, 'http listening (health + push)');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    if (subscription !== null) {
      try {
        await subscription.close();
        logger.info('subscription closed');
      } catch (e) {
        logger.error({ err: e }, 'error closing subscription');
      }
    }
    // Un solo tope para los dos transportes: deja de aceptar requests y espera
    // a los push y a los handlers pull en curso.
    const httpClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    const drained = await withinDeadline(
      Promise.all([httpClosed, Promise.allSettled([...pullInFlight])]),
      SHUTDOWN_DRAIN_MS,
    );
    if (!drained) {
      logger.warn(
        { drainMs: SHUTDOWN_DRAIN_MS, pullInFlight: pullInFlight.size },
        'shutdown: mensajes en curso sin terminar',
      );
    }
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
