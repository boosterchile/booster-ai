import http from 'node:http';
import { type AvlPacket, type AvlRecord, extractCrashTrace } from '@booster-ai/codec8-parser';
import { createLogger } from '@booster-ai/logger';
import { BigQuery } from '@google-cloud/bigquery';
import { type Message, PubSub, type Subscription } from '@google-cloud/pubsub';
import { Storage } from '@google-cloud/storage';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadConfig } from './config.js';
import {
  createBigQueryCrashTraceIndexer,
  createGcsCrashTraceUploader,
} from './crash-trace-adapters.js';
import { crashTraceMessageSchema, persistCrashTrace } from './persist-crash-trace.js';
import { persistGreenDrivingFromRecord } from './persist-green-driving.js';
import { persistRecord, recordMessageSchema } from './persist.js';

/**
 * telemetry-processor: consumer Pub/Sub de dos topics:
 *
 *   1. `telemetry-events-processor-sub` → records individuales →
 *      persistRecord en `telemetria_puntos`.
 *
 *   2. `crash-traces-processor-sub` (Wave 2 B3) → packet completo de
 *      Crash → extractCrashTrace + persistCrashTrace (GCS + BigQuery).
 *
 * Diseño:
 *   - Cada subscription corre con su propio flow control y ack policy.
 *   - Por mensaje: zod parse → persist → ack/nack.
 *   - ack inmediato si valida + persistió.
 *   - nack si error transitorio (DB / GCS / BQ).
 *   - ack + log si validación falla (mensaje malformado).
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
      crashSubscription: config.PUBSUB_SUBSCRIPTION_CRASH_TRACES,
      crashBucket: config.GCS_CRASH_TRACES_BUCKET || '(disabled)',
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

  // -------------------------------------------------------------------------
  // CONSUMER 1: telemetry-events (records individuales)
  // -------------------------------------------------------------------------

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

      // Phase 2 PR-I2 — extraer y persistir eventos green-driving del
      // mismo record. Solo aplica si el record tiene IO 253 o IO 255
      // (caso minoritario: 5-50 eventos por trip vs ~100 puntos por
      // trip). El extractor es side-effect-free; persistencia falla
      // silenciosa (loggea + sigue) para no bloquear el ack del punto
      // principal — los eventos no son críticos para el lifecycle del
      // viaje, son solo input al scoring.
      let greenDrivingInserted = 0;
      try {
        const gdResult = await persistGreenDrivingFromRecord({
          db,
          logger,
          msg: parsed.data,
        });
        greenDrivingInserted = gdResult.insertedCount;
      } catch (err) {
        logger.error(
          {
            err,
            messageId: message.id,
            imei: parsed.data.imei,
            vehicleId: parsed.data.vehicleId,
          },
          'green-driving persist falló, ack del record igual (no bloquea)',
        );
      }

      message.ack();

      logger.info(
        {
          messageId: message.id,
          imei: parsed.data.imei,
          vehicleId: parsed.data.vehicleId,
          inserted: result.inserted,
          isFirstPointForVehicle: result.isFirstPointForVehicle,
          greenDrivingInserted,
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

  // -------------------------------------------------------------------------
  // CONSUMER 2: crash-traces (packet completo, Wave 2 B3)
  // -------------------------------------------------------------------------

  const crashSubscription: Subscription | null = config.GCS_CRASH_TRACES_BUCKET
    ? pubsub.subscription(config.PUBSUB_SUBSCRIPTION_CRASH_TRACES, {
        // Crash Traces son raros y caros de procesar (upload GCS + insert BQ).
        // Bajamos el flow control para no saturar.
        flowControl: { maxMessages: 5 },
      })
    : null;

  if (crashSubscription) {
    const storage = new Storage({ projectId: config.GOOGLE_CLOUD_PROJECT });
    const bigquery = new BigQuery({ projectId: config.GOOGLE_CLOUD_PROJECT });
    const uploader = createGcsCrashTraceUploader(storage);
    const indexer = createBigQueryCrashTraceIndexer(bigquery);

    const crashHandler = async (message: Message): Promise<void> => {
      const start = Date.now();
      try {
        const body = JSON.parse(message.data.toString('utf-8'));
        const parsed = crashTraceMessageSchema.safeParse(body);
        if (!parsed.success) {
          logger.error(
            {
              messageId: message.id,
              errors: parsed.error.issues,
              bodyPreview: message.data.toString('utf-8').slice(0, 200),
            },
            'crash-trace malformado, ack para descartar',
          );
          message.ack();
          return;
        }

        const packet = deserializeAvlPacket(parsed.data.packet);
        const trace = extractCrashTrace(packet);
        if (!trace) {
          // Defensa en depth: el gateway debería filtrar pero si llega un
          // packet sin Crash event, ack y log warn.
          logger.warn(
            { messageId: message.id, imei: parsed.data.imei },
            'crash-trace sin event marker 247, descartando',
          );
          message.ack();
          return;
        }

        const result = await persistCrashTrace({
          trace,
          vehicleId: parsed.data.vehicleId,
          imei: parsed.data.imei,
          uploader,
          indexer,
          bucketName: config.GCS_CRASH_TRACES_BUCKET,
          bigQueryDatasetId: config.BIGQUERY_CRASH_DATASET,
          bigQueryTableId: config.BIGQUERY_CRASH_TABLE,
          logger,
        });

        message.ack();
        logger.info(
          {
            messageId: message.id,
            crashId: result.crashId,
            gcsPath: result.gcsPath,
            imei: parsed.data.imei,
            latencyMs: Date.now() - start,
          },
          'crash-trace persistido',
        );
      } catch (err) {
        // Aborta el ack — Pub/Sub reintenta. Tras N fallos va al DLQ y
        // dispara la métrica `crash_trace_persistence_failures`.
        logger.error(
          { err, messageId: message.id },
          'error persistiendo crash-trace, nack para reintento',
        );
        message.nack();
      }
    };

    crashSubscription.on('message', (m) => void crashHandler(m));
    crashSubscription.on('error', (err) => {
      logger.error({ err }, 'crash-trace subscription error');
    });
  } else {
    logger.warn('GCS_CRASH_TRACES_BUCKET no configurado — crash-trace consumer DESHABILITADO');
  }

  // -------------------------------------------------------------------------
  // Health probe HTTP
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    try {
      await subscription.close();
      logger.info('subscription closed');
    } catch (e) {
      logger.error({ err: e }, 'error closing subscription');
    }
    if (crashSubscription) {
      try {
        await crashSubscription.close();
        logger.info('crash-trace subscription closed');
      } catch (e) {
        logger.error({ err: e }, 'error closing crash-trace subscription');
      }
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

/**
 * Reconstruye un `AvlPacket` desde el mensaje serializado: convierte
 * `timestampMs` (string en JSON) a BigInt para que `extractCrashTrace`
 * pueda compararlos numéricamente.
 *
 * IO entries con `value` como string se convierten a BigInt cuando
 * `byteSize === 8` (el gateway serializa BigInts como string para
 * preservar precisión).
 */
function deserializeAvlPacket(
  raw: import('zod').infer<typeof crashTraceMessageSchema.shape.packet>,
): AvlPacket {
  const records: AvlRecord[] = raw.records.map((r) => ({
    timestampMs: BigInt(r.timestampMs),
    priority: r.priority,
    gps: r.gps,
    io: {
      eventIoId: r.io.eventIoId,
      totalIo: r.io.totalIo,
      entries: r.io.entries.map((e) => ({
        id: e.id,
        // value: si es string + byteSize 8 → BigInt; si es string en otros tamaños
        // (no debería pasar) lo dejamos como número parseado defensivamente.
        value:
          typeof e.value === 'string'
            ? e.byteSize === 8
              ? BigInt(e.value)
              : Number(e.value)
            : e.value,
        byteSize: e.byteSize,
      })),
    },
  }));
  return {
    codecId: raw.codecId,
    recordCount: raw.recordCount,
    records,
  };
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
