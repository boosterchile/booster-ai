import { createLogger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { parseSmsFallback } from './parser.js';
import { validateTwilioSignature } from './twilio-signature.js';

/**
 * sms-fallback-gateway: HTTP Cloud Run service que recibe webhooks de
 * Twilio cuando un FMC150 envía SMS de fallback ante GPRS caído
 * (Wave 2 Track B4).
 *
 * Flujo:
 *   1. Device detecta evento Panic (Crash/Unplug/GNSS Jamming) y no
 *      tiene GPRS — envía SMS al número Twilio configurado.
 *   2. Twilio recibe el SMS y POSTea webhook a `/webhook` con
 *      `application/x-www-form-urlencoded` body (campos `From`,
 *      `Body`, `MessageSid`, etc.) + header `X-Twilio-Signature`.
 *   3. Validamos la firma con HMAC-SHA1.
 *   4. Parseamos el body con formato canónico Booster.
 *   5. Publicamos al mismo topic `telemetry-events` que el TCP gateway
 *      con un atributo `is_sms_fallback=true` para que el processor
 *      sepa que viene por canal SMS (priority alta, no requiere
 *      Crash Trace).
 *
 * Idempotencia: Twilio puede reintentar el webhook si recibe non-2xx.
 * El processor downstream tiene UNIQUE (imei, timestamp_device) en
 * `telemetria_puntos`, así que duplicados son OK.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/sms-fallback-gateway',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  const signatureCheckEnabled = Boolean(config.TWILIO_AUTH_TOKEN && config.WEBHOOK_PUBLIC_URL);
  if (!signatureCheckEnabled && config.NODE_ENV === 'production') {
    logger.fatal(
      'TWILIO_AUTH_TOKEN o WEBHOOK_PUBLIC_URL faltante en producción — rechazando todos los webhooks',
    );
  } else if (!signatureCheckEnabled) {
    logger.warn('signature check Twilio DESHABILITADO (env no productivo)');
  }

  const pubsub = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT });
  const topic = pubsub.topic(config.PUBSUB_TOPIC_TELEMETRY);

  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'sms-fallback-gateway' }));

  app.post('/webhook', async (c) => {
    const start = Date.now();

    // 1. Read body — Twilio manda application/x-www-form-urlencoded.
    const formData = await c.req.formData();
    const params: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      params[k] = String(v);
    }

    const messageSid = params.MessageSid ?? 'unknown';
    const fromNumber = params.From ?? '';
    const body = params.Body ?? '';

    // 2. Verificar firma Twilio.
    if (signatureCheckEnabled) {
      const signature = c.req.header('X-Twilio-Signature') ?? '';
      const isValid = validateTwilioSignature({
        authToken: config.TWILIO_AUTH_TOKEN,
        signature,
        url: config.WEBHOOK_PUBLIC_URL,
        params,
      });
      if (!isValid) {
        logger.warn(
          { messageSid, fromNumber, signaturePreview: signature.slice(0, 8) },
          'firma Twilio inválida — rechazando',
        );
        return c.text('Forbidden', 403);
      }
    } else if (config.NODE_ENV === 'production') {
      logger.error({ messageSid }, 'webhook recibido sin signature check en prod');
      return c.text('Service Unavailable', 503);
    }

    // 3. Parsear body con formato canónico Booster.
    const parseResult = parseSmsFallback(body);
    if (!parseResult.ok) {
      logger.warn(
        { messageSid, fromNumber, error: parseResult.error, raw: parseResult.raw },
        'sms body no parseable — descartando con 200 (no retry)',
      );
      // 200 OK para que Twilio no reintente — mensaje no canónico.
      return c.text('OK', 200);
    }

    const { payload } = parseResult;

    // 4. Publicar al topic telemetry-events.
    const messageBody = {
      imei: payload.imei,
      vehicleId: null, // resuelto downstream por el processor (lookup en DB)
      record: {
        timestampMs: String(payload.timestampMs),
        priority: 2, // panic — siempre, los SMS solo se mandan para Panic events
        gps: {
          longitude: payload.longitude,
          latitude: payload.latitude,
          altitude: 0,
          angle: 0,
          satellites: 0,
          speedKmh: payload.speedKmh,
        },
        io: {
          eventIoId: payload.avlId,
          totalIo: 1,
          entries: [
            {
              id: payload.avlId,
              value: payload.rawValue,
              byteSize: 1,
            },
          ],
        },
      },
    };

    try {
      const publishedId = await topic.publishMessage({
        data: Buffer.from(JSON.stringify(messageBody)),
        attributes: {
          imei: payload.imei,
          priority: '2',
          source: 'sms-fallback',
          avl_id: String(payload.avlId),
        },
      });

      logger.info(
        {
          messageSid,
          fromNumber,
          imei: payload.imei,
          avlId: payload.avlId,
          publishedId,
          latencyMs: Date.now() - start,
        },
        'sms fallback procesado',
      );

      return c.text('OK', 200);
    } catch (err) {
      logger.error({ err, messageSid, imei: payload.imei }, 'fallo publish a Pub/Sub');
      // 500 → Twilio reintenta el webhook.
      return c.text('Internal Server Error', 500);
    }
  });

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info({ port: info.port }, 'sms-fallback-gateway listening');
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received, closing');
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
