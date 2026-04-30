import { type Logger, createLogger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type pg from 'pg';
import { config } from './config.js';
import type { Db } from './db/client.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createHealthRouter } from './routes/health.js';
import { createTripRequestsRoutes } from './routes/trip-requests.js';

export interface CreateServerOptions {
  db: Db;
  pool: pg.Pool;
  logger?: Logger;
}

export function createServer(opts: CreateServerOptions): Hono {
  const logger =
    opts.logger ??
    createLogger({
      service: config.SERVICE_NAME,
      version: config.SERVICE_VERSION,
      level: config.LOG_LEVEL,
      pretty: config.NODE_ENV === 'development',
    });

  const app = new Hono();

  // Request logging middleware
  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: ms,
      },
      'request',
    );
  });

  app.use(
    '*',
    cors({
      origin: config.CORS_ALLOWED_ORIGINS,
      credentials: true,
    }),
  );

  app.use('*', secureHeaders());

  // Public routes (no auth) — /health (liveness) + /ready (DB ping).
  app.route('/', createHealthRouter({ pool: opts.pool, logger }));

  // Protected routes — OIDC token from allowed Cloud Run SA required
  const authMiddleware = createAuthMiddleware({
    apiAudience: config.API_AUDIENCE,
    allowedCallerSa: config.ALLOWED_CALLER_SA,
    logger,
  });

  app.use('/trip-requests/*', authMiddleware);
  app.route('/trip-requests', createTripRequestsRoutes({ db: opts.db, logger }));

  app.onError((err, c) => {
    logger.error({ err }, 'unhandled error');
    return c.json({ error: 'internal_server_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
