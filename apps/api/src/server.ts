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
import { createUserContextMiddleware } from './middleware/user-context.js';
import { createAdminDispositivosRoutes } from './routes/admin-dispositivos.js';
import { createEmpresaRoutes } from './routes/empresas.js';
import { createHealthRouter } from './routes/health.js';
import { createMeRoutes } from './routes/me.js';
import { createOfferRoutes } from './routes/offers.js';
import { createTripRequestsV2Routes } from './routes/trip-requests-v2.js';
import { createTripRequestsRoutes } from './routes/trip-requests.js';
import { createVehiculosRoutes } from './routes/vehiculos.js';
import type { NotifyOfferDeps } from './services/notify-offer.js';

export interface CreateServerOptions {
  db: Db;
  pool: pg.Pool;
  /**
   * Firebase Admin Auth instance. Inyectable para tests (y null-safe para
   * facilitar tests que no necesitan Firebase, como /health).
   */
  firebaseAuth?: Auth;
  logger?: Logger;
  /**
   * Deps del dispatcher de notificaciones. Inyectado desde main.ts en
   * producción; opcional en tests donde se omite si no se quieren
   * notificaciones reales.
   */
  notify?: NotifyOfferDeps;
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
    app.use('/me/*', firebaseAuthMiddleware);
    app.route('/me', createMeRoutes({ db: opts.db, logger }));

    // Empresas — POST /empresas/onboarding crea user+empresa+membership.
    // Solo firebaseAuth (no userContext) porque el user todavía no existe
    // en la DB cuando llama acá.
    app.use('/empresas/*', firebaseAuthMiddleware);
    app.route('/empresas', createEmpresaRoutes({ db: opts.db, logger }));

    // Trip requests v2 (canonical) — Firebase auth + userContext porque
    // el shipper ya tiene empresa onboardeada. activeMembership.empresa
    // se usa como shipper_empresa_id.
    const userContextMiddleware = createUserContextMiddleware({ db: opts.db, logger });
    app.use('/trip-requests-v2/*', firebaseAuthMiddleware);
    app.use('/trip-requests-v2/*', userContextMiddleware);
    app.route(
      '/trip-requests-v2',
      createTripRequestsV2Routes({
        db: opts.db,
        logger,
        ...(opts.notify ? { notify: opts.notify } : {}),
      }),
    );

    // Offers — endpoints carrier-side: GET mine + POST accept/reject.
    // Mismo chain firebaseAuth + userContext.
    app.use('/offers/*', firebaseAuthMiddleware);
    app.use('/offers/*', userContextMiddleware);
    app.route('/offers', createOfferRoutes({ db: opts.db, logger }));

    // Admin: gestión de dispositivos Teltonika pendientes (open enrollment).
    app.use('/admin/dispositivos-pendientes/*', firebaseAuthMiddleware);
    app.use('/admin/dispositivos-pendientes/*', userContextMiddleware);
    app.route(
      '/admin/dispositivos-pendientes',
      createAdminDispositivosRoutes({ db: opts.db, logger }),
    );

    // Vehículos de la empresa activa.
    app.use('/vehiculos/*', firebaseAuthMiddleware);
    app.use('/vehiculos/*', userContextMiddleware);
    app.use('/vehiculos', firebaseAuthMiddleware);
    app.use('/vehiculos', userContextMiddleware);
    app.route('/vehiculos', createVehiculosRoutes({ db: opts.db, logger }));
  } else {
    logger.warn(
      'firebaseAuth instance not provided — /me + /empresas routes disabled. Esto solo es OK en tests que no necesitan auth de usuario.',
    );
  }

  app.onError((err, c) => {
    logger.error({ err }, 'unhandled error');
    return c.json({ error: 'internal_server_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  return app;
}
