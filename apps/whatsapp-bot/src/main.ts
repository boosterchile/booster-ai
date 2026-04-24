import { createLogger } from '@booster-ai/logger';
import { WhatsAppClient } from '@booster-ai/whatsapp-client';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
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

const whatsAppClient = new WhatsAppClient({
  phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
  accessToken: config.WHATSAPP_ACCESS_TOKEN,
  logger,
});

const apiClient = new ApiClient({
  apiUrl: config.API_URL,
  audience: config.API_OIDC_AUDIENCE,
  logger,
});

const store = new ConversationStore(config.CONVERSATION_TTL_MS);

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
    appSecret: config.WHATSAPP_APP_SECRET,
    verifyToken: config.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
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
    logger.info({ signal, activeSessions: store.size() }, 'shutdown signal received');
    server.close(() => process.exit(0));
  });
}
