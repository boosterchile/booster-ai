import { createLogger } from '@booster-ai/logger';
import { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import Redis from 'ioredis';
import { config } from './config.js';
import { ConversationStore } from './conversation/store.js';
import { healthRouter } from './routes/health.js';
import { createWebhookRoutes } from './routes/webhook.js';
import { ApiClient } from './services/api-client.js';

const logger = createLogger({
  service: config.SERVICE_NAME,
  version: config.SERVICE_VERSION,
  level: config.LOG_LEVEL,
  pretty: config.NODE_ENV === 'development',
});

// Redis client compartido — conversation store + futuras features (rate limit,
// dedup de mensajes Twilio, etc.). Modo lazy connect para que el startup probe
// del Cloud Run no se bloquee si Redis arranca lento.
const redis = new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  tls: config.REDIS_TLS ? {} : undefined,
  // Reintentar conexión con backoff exponencial — sin esto, una caída de Redis
  // tira el proceso entero.
  retryStrategy: (times) => Math.min(times * 200, 2000),
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on('error', (err) => {
  // Loggear pero no crashear — los handlers del bot manejan errores de Redis
  // localmente. Si Redis se cae, las conversaciones nuevas fallan pero el bot
  // sigue serving (puede responder con mensaje de error gracioso).
  logger.error({ err }, 'redis connection error');
});

redis.on('connect', () => logger.info('redis connected'));

const whatsAppClient = new TwilioWhatsAppClient({
  accountSid: config.TWILIO_ACCOUNT_SID,
  authToken: config.TWILIO_AUTH_TOKEN,
  fromNumber: config.TWILIO_FROM_NUMBER,
  logger,
});

const apiClient = new ApiClient({
  apiUrl: config.API_URL,
  audience: config.API_OIDC_AUDIENCE,
  logger,
});

const store = new ConversationStore(redis, config.CONVERSATION_TTL_MS, logger);

const app = new Hono();

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  logger.info(
    {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - start,
    },
    'request',
  );
});

app.use('*', secureHeaders());

app.route('/', healthRouter);
app.route(
  '/',
  createWebhookRoutes({
    store,
    whatsAppClient,
    apiClient,
    redis,
    authToken: config.TWILIO_AUTH_TOKEN,
    webhookUrl: config.TWILIO_WEBHOOK_URL,
    logger,
  }),
);

app.onError((err, c) => {
  logger.error({ err }, 'unhandled error');
  return c.json({ error: 'internal_server_error' }, 500);
});

app.notFound((c) => c.json({ error: 'not_found' }, 404));

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
  },
  (info) => {
    logger.info({ port: info.port, env: config.NODE_ENV }, 'booster-ai-whatsapp-bot listening');
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutdown signal received');
    server.close(() => {
      // Cerrar Redis después del HTTP server para drenar requests in-flight.
      redis.quit().finally(() => process.exit(0));
    });
  });
}
