import http from 'node:http';
import { createLogger } from '@booster-ai/logger';
import { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { type Message, PubSub } from '@google-cloud/pubsub';
import { loadConfig } from './config.js';
import { crearManejadorMensajes } from './consumer.js';
import { procesarEventoNotificacion } from './procesar-evento.js';

/**
 * notification-service (T10-21): consumer pull de `notification-events`.
 * Entrega WhatsApp (Twilio Content Templates) publicados por el api cuando
 * `NOTIFICATIONS_VIA_MICROSERVICE=true`, y compara en sombra cuando
 * `NOTIFICATIONS_SHADOW=true`. Sin base de datos ni Redis: emisor sin estado.
 * Spec: `.specs/notification-service-t10-21/spec.md`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    service: '@booster-ai/notification-service',
    version: process.env.SERVICE_VERSION ?? '0.0.0-dev',
    level: config.LOG_LEVEL,
    pretty: config.NODE_ENV === 'development',
  });

  logger.info(
    {
      project: config.GOOGLE_CLOUD_PROJECT,
      subscription: config.PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS,
      maxInFlight: config.MAX_MESSAGES_IN_FLIGHT,
    },
    'notification-service starting',
  );

  const sender = new TwilioWhatsAppClient({
    accountSid: config.TWILIO_ACCOUNT_SID,
    authToken: config.TWILIO_AUTH_TOKEN,
    fromNumber: config.TWILIO_FROM_NUMBER,
    logger,
  });

  const manejar = crearManejadorMensajes({
    procesar: (data) =>
      procesarEventoNotificacion({ data, sender, fromNumber: config.TWILIO_FROM_NUMBER, logger }),
    logger,
  });

  const subscription = new PubSub({ projectId: config.GOOGLE_CLOUD_PROJECT }).subscription(
    config.PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS,
    { flowControl: { maxMessages: config.MAX_MESSAGES_IN_FLIGHT } },
  );
  subscription.on('message', (m: Message) => void manejar(m));
  subscription.on('error', (err) => {
    logger.error({ err }, 'subscription error');
  });

  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'notification-service' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  healthServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'health probe listening');
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
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  const bootstrapLogger = createLogger({
    service: '@booster-ai/notification-service',
    level: 'fatal',
  });
  bootstrapLogger.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
