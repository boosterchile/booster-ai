import { type Logger, createLogger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type pg from 'pg';
import { config } from './config.js';
import type { Db } from './db/client.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createFirebaseAuthMiddleware } from './middleware/firebase-auth.js';
import { createHealthRouter } from './routes/health.js';
import { createMeRoutes } from './routes/me.js';
import { createTripRequestsRoutes } from './routes/trip-requests.js';

export interface CreateServerOptions {
  db: Db;
  pool: pg.Pool;
  /**
   * Firebase Admin Auth instance. Inyectable para tests (y null-safe para
   * facilitar tests que no necesitan Firebase, como /health).
   */
  firebaseAuth?: Auth;
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

  // End-user routes (Firebase ID token required). /me es especial: no usa
  // userContext middleware porque el user puede no existir aún en la DB
  // (post-signup pre-onboarding).
  if (opts.firebaseAuth) {
    const firebaseAuthMiddleware = createFirebaseAuthMiddleware({
      auth: opts.firebaseAuth,
      logger,
    });
    app.use('/me', firebaseAuthMiddleware);
    app.route('/me', createMeRoutes({ db: opts.db, logger }));
  } else {
    logger.warn(
      'firebaseAuth instance not provided — /me route disabled. Esto solo es OK en tests que no necesitan auth de usuario.',
    );
  }

  app.onError((err, c) => {
    logger.error({ err }, 'unhandled error');
    return c.json({ error: 'internal_server_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
