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
import { createAdminCobraHoyRoutes } from './routes/admin-cobra-hoy.js';
import { createAdminDispositivosRoutes } from './routes/admin-dispositivos.js';
import { createAdminJobsRoutes } from './routes/admin-jobs.js';
import { createAdminLiquidacionesRoutes } from './routes/admin-liquidaciones.js';
import { createAdminMatchingBacktestRoutes } from './routes/admin-matching-backtest.js';
import { createAdminObservabilityRoutes } from './routes/admin-observability.js';
import { createAdminSeedRoutes } from './routes/admin-seed.js';
import { createAdminStakeholderOrgsRoutes } from './routes/admin-stakeholder-orgs.js';
import { createAssignmentsRoutes } from './routes/assignments.js';
import { createDriverAuthRoutes } from './routes/auth-driver.js';
import { createAuthUniversalRoutes } from './routes/auth-universal.js';
import { createCertificatesRoutes } from './routes/certificates.js';
import { createChatRoutes } from './routes/chat.js';
import { createCobraHoyAssignmentsRoutes, createCobraHoyMeRoutes } from './routes/cobra-hoy.js';
import { createConductoresRoutes } from './routes/conductores.js';
import { createDemoLoginRoutes } from './routes/demo-login.js';
import { createCumplimientoRoutes, createDocumentosRoutes } from './routes/documentos.js';
import { createEmpresaRoutes } from './routes/empresas.js';
import { createFeatureFlagsRoutes } from './routes/feature-flags.js';
import { createHealthRouter } from './routes/health.js';
import { createMeClaveNumericaRoutes } from './routes/me-clave-numerica.js';
import { createMeConsentsRoutes } from './routes/me-consents.js';
import { createMeLiquidacionesRoutes } from './routes/me-liquidaciones.js';
import { createMeRoutes } from './routes/me.js';
import { createOfferRoutes } from './routes/offers.js';
import { createPublicTrackingRoutes } from './routes/public-tracking.js';
import {
  createPublicSiteSettingsRoutes,
  createSiteSettingsRoutes,
} from './routes/site-settings.js';
import { createSucursalesRoutes } from './routes/sucursales.js';
import { createTripRequestsV2Routes } from './routes/trip-requests-v2.js';
import { createTripRequestsRoutes } from './routes/trip-requests.js';
import { createVehiculosRoutes } from './routes/vehiculos.js';
import { createMePushSubscriptionRoutes, createWebpushPublicRoutes } from './routes/webpush.js';
import type { NotifyOfferDeps } from './services/notify-offer.js';
import type { NotifyTrackingLinkDeps } from './services/notify-tracking-link.js';
import { buildObservabilityServices } from './services/observability/factory.js';
import { configureWebPush } from './services/web-push.js';

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
  /**
   * Phase 5 PR-L3 — Deps del dispatcher del link público de tracking
   * al shipper (post-accept oferta). Comparte twilioClient con `notify`.
   */
  notifyTrackingLink?: NotifyTrackingLinkDeps;
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

  // P3.c — VAPID config global (idempotente). Si las env vars están
  // ausentes, configureWebPush no hace nada y el wire post-INSERT
  // skipea con warn. Esto permite dev sin VAPID.
  if (config.WEBPUSH_VAPID_PUBLIC_KEY && config.WEBPUSH_VAPID_PRIVATE_KEY) {
    configureWebPush({
      publicKey: config.WEBPUSH_VAPID_PUBLIC_KEY,
      privateKey: config.WEBPUSH_VAPID_PRIVATE_KEY,
      subject: config.WEBPUSH_VAPID_SUBJECT,
    });
  } else {
    logger.warn(
      'VAPID keys ausentes — Web Push deshabilitado. POST /me/push-subscription igual responde 200 pero los mensajes no disparan notif.',
    );
  }

  // Public routes (no auth) — /health (liveness) + /ready (DB ping).
  app.route('/', createHealthRouter({ pool: opts.pool, logger }));

  // Public route — /webpush/vapid-public-key (necesario para que el browser
  // pueda subscribe; no es secreto, es la identidad del sender).
  app.route(
    '/webpush',
    createWebpushPublicRoutes({
      ...(config.WEBPUSH_VAPID_PUBLIC_KEY
        ? { vapidPublicKey: config.WEBPUSH_VAPID_PUBLIC_KEY }
        : {}),
    }),
  );

  // Public route — GET /feature-flags (ADR-035 + ADR-036).
  // El cliente lo llama en boot para decidir qué UI renderizar en
  // /login (selector RUT+clave vs email/password legacy). NO requiere
  // auth porque la decisión de UI ocurre ANTES del login.
  app.route('/feature-flags', createFeatureFlagsRoutes({ logger }));

  // Public route — POST /demo/login (modo demo subdominio).
  // Mintea custom token Firebase para la persona demo (shipper/carrier/
  // conductor/stakeholder). Endpoint público (sin firebase auth previa)
  // porque la PWA en demo.boosterchile.com quiere login con un click
  // sin tipear nada. Doble guard: flag DEMO_MODE_ACTIVATED + columna
  // `es_demo=true` en BD. Si flag OFF, responde 404. Si firebaseAuth no
  // está inyectado (tests), no se monta para evitar runtime errors.
  if (opts.firebaseAuth) {
    app.route(
      '/demo',
      createDemoLoginRoutes({ db: opts.db, firebaseAuth: opts.firebaseAuth, logger }),
    );
  }

  // Phase 5 PR-L1 — Public tracking del shipper / consignee. NO auth:
  // la defensa es la opacidad del token UUID v4 (122 bits, no enumerable).
  // El handler restringe los datos expuestos (plate parcial, sin
  // driver name, telemetría sólo <30min).
  //
  // ADR-038: Routes API via ADC. Pasamos GOOGLE_CLOUD_PROJECT en lugar
  // de API key — el SA del runtime se autentica via workload identity, y
  // el projectId va en X-Goog-User-Project. Si la env var está ausente,
  // fallback transparente al ETA al centroide regional (PR-L2b).
  app.route(
    '/public/tracking',
    createPublicTrackingRoutes({
      db: opts.db,
      logger,
      ...(config.GOOGLE_CLOUD_PROJECT ? { routesProjectId: config.GOOGLE_CLOUD_PROJECT } : {}),
    }),
  );

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
    // userContext requerido para /me/push-subscription (necesita user.id).
    // /me raíz queda con solo firebase auth (acepta users pre-onboarding).
    const userContextMiddlewareForMe = createUserContextMiddleware({
      db: opts.db,
      logger,
    });
    app.use('/me/push-subscription', userContextMiddlewareForMe);
    app.use('/me/push-subscription/*', userContextMiddlewareForMe);
    const meRouter = createMeRoutes({ db: opts.db, logger });
    meRouter.route('/push-subscription', createMePushSubscriptionRoutes({ db: opts.db, logger }));
    // Stakeholder consent grants (ADR-028 §"Acciones derivadas §7"). Sólo
    // requiere firebaseAuth — el handler resuelve userId vía firebase_uid.
    meRouter.route('/consents', createMeConsentsRoutes({ db: opts.db, logger }));
    // ADR-035 Wave 4 PR 3 — setear/rotar clave numérica del usuario.
    // Solo firebaseAuth (no userContext) porque el handler resuelve
    // userId vía firebase_uid; aplica a cualquier usuario logueado,
    // incluso pre-onboarding.
    meRouter.route('/', createMeClaveNumericaRoutes({ db: opts.db, logger }));
    // Cobra Hoy historial (requiere userContext para empresa activa).
    app.use('/me/cobra-hoy/*', userContextMiddlewareForMe);
    meRouter.route('/', createCobraHoyMeRoutes({ db: opts.db, logger }));
    // Liquidaciones del carrier activo (ADR-031 §4.1). Requiere
    // userContext + flag PRICING_V2_ACTIVATED.
    app.use('/me/liquidaciones', userContextMiddlewareForMe);
    meRouter.route('/', createMeLiquidacionesRoutes({ db: opts.db, logger }));
    app.route('/me', meRouter);

    // Empresas — POST /empresas/onboarding crea user+empresa+membership.
    // Solo firebaseAuth (no userContext) porque el user todavía no existe
    // en la DB cuando llama acá.
    app.use('/empresas/*', firebaseAuthMiddleware);
    app.route('/empresas', createEmpresaRoutes({ db: opts.db, logger }));

    // Trip requests v2 (canonical) — Firebase auth + userContext porque
    // el shipper ya tiene empresa onboardeada. activeMembership.empresa
    // se usa como shipper_empresa_id.
    const userContextMiddleware = createUserContextMiddleware({ db: opts.db, logger });
    // Config para emisión de certificados de huella de carbono. Se usa
    // como fire-and-forget cuando un viaje pasa a 'entregado' (desde
    // /trip-requests-v2/:id/confirmar-recepcion o /assignments/:id/confirmar-entrega).
    // Si las env vars no están seteadas, el wire skipea el cert con warn
    // (útil en dev sin KMS); en prod Terraform las inyecta siempre.
    // verifyBaseUrl es la primera entrada de API_AUDIENCE (URL pública,
    // ej. https://api.boosterchile.com).
    const certConfig = {
      ...(config.CERTIFICATE_SIGNING_KEY_ID ? { kmsKeyId: config.CERTIFICATE_SIGNING_KEY_ID } : {}),
      ...(config.CERTIFICATES_BUCKET ? { certificatesBucket: config.CERTIFICATES_BUCKET } : {}),
      verifyBaseUrl: config.API_AUDIENCE[0] ?? 'https://api.boosterchile.com',
    };

    app.use('/trip-requests-v2/*', firebaseAuthMiddleware);
    app.use('/trip-requests-v2/*', userContextMiddleware);
    app.route(
      '/trip-requests-v2',
      createTripRequestsV2Routes({
        db: opts.db,
        logger,
        certConfig,
        ...(opts.notify ? { notify: opts.notify } : {}),
      }),
    );

    // Offers — endpoints carrier-side: GET mine + POST accept/reject.
    // Mismo chain firebaseAuth + userContext.
    app.use('/offers/*', firebaseAuthMiddleware);
    app.use('/offers/*', userContextMiddleware);
    app.route(
      '/offers',
      createOfferRoutes({
        db: opts.db,
        logger,
        ...(opts.notifyTrackingLink ? { notifyTrackingLink: opts.notifyTrackingLink } : {}),
      }),
    );

    // Admin jobs — endpoints internos disparados por Cloud Scheduler
    // (P3.d chat WhatsApp fallback). Auth: OIDC token con email = SA del
    // scheduler (INTERNAL_CRON_CALLER_SA). Si la env var no está,
    // skippeamos el wire (ningún caller pasa el middleware).
    if (config.INTERNAL_CRON_CALLER_SA) {
      const cronAuthMiddleware = createAuthMiddleware({
        apiAudience: config.API_AUDIENCE,
        allowedCallerSa: config.INTERNAL_CRON_CALLER_SA,
        logger,
      });
      app.use('/admin/jobs/*', cronAuthMiddleware);
      app.route(
        '/admin/jobs',
        createAdminJobsRoutes({
          db: opts.db,
          logger,
          twilioClient: opts.notify?.twilioClient ?? null,
          contentSidChatUnread: config.CONTENT_SID_CHAT_UNREAD ?? null,
          webAppUrl: config.WEB_APP_URL,
        }),
      );
    } else {
      logger.warn('INTERNAL_CRON_CALLER_SA ausente — endpoints /admin/jobs/* deshabilitados');
    }

    // Assignments — endpoints sobre assignment lifecycle + chat.
    //   - PATCH /:id/confirmar-entrega → createAssignmentsRoutes (carrier POD)
    //   - {POST,GET,PATCH} /:id/messages* → createChatRoutes (chat shipper↔carrier)
    //
    // Composición: el assignmentsRouter monta el chatRouter como sub-route
    // (sin prefix adicional) para que ambos compartan /assignments. Las
    // rutas no chocan porque los paths internos son distintos
    // (/:id/confirmar-entrega vs /:id/messages*).
    app.use('/assignments/*', firebaseAuthMiddleware);
    app.use('/assignments/*', userContextMiddleware);
    const assignmentsRouter = createAssignmentsRoutes({
      db: opts.db,
      logger,
      certConfig,
      // ADR-038: Routes API via ADC. GOOGLE_CLOUD_PROJECT va como
      // X-Goog-User-Project. Sin él, GET /assignments/:id/eco-route
      // devuelve polyline_encoded=null con status='no_routes_api_key'.
      ...(config.GOOGLE_CLOUD_PROJECT ? { routesProjectId: config.GOOGLE_CLOUD_PROJECT } : {}),
    });
    const chatRouter = createChatRoutes({
      db: opts.db,
      logger,
      webAppUrl: config.WEB_APP_URL,
      ...(config.CHAT_ATTACHMENTS_BUCKET
        ? { attachmentsBucket: config.CHAT_ATTACHMENTS_BUCKET }
        : {}),
      ...(config.CHAT_PUBSUB_TOPIC ? { pubsubTopic: config.CHAT_PUBSUB_TOPIC } : {}),
    });
    assignmentsRouter.route('/', chatRouter);
    // Cobra Hoy assignment-scoped (ADR-029 + ADR-032).
    assignmentsRouter.route('/', createCobraHoyAssignmentsRoutes({ db: opts.db, logger }));
    app.route('/assignments', assignmentsRouter);

    // Certificates — listado privado (auth shipper) + verify público.
    //
    // GET /certificates                       → auth shipper requerido
    // GET /certificates/:tracking_code/verify → PÚBLICO (sin auth)
    //
    // Hono no permite mezclar middlewares por método/path nativamente,
    // así que envolvemos firebaseAuth + userContext en wrappers que
    // hacen short-circuit al `next()` si la URL matchea verify. El cost
    // del check es 1 regex por request (despreciable) y mantiene la URL
    // elegante /certificates/:tracking/verify (en vez de algo como
    // /public/verify-cert/:tracking).
    const skipAuthForVerify = /\/certificates\/[^/]+\/verify$/;
    app.use('/certificates/*', async (c, next) => {
      if (c.req.method === 'GET' && skipAuthForVerify.test(c.req.path)) {
        return next();
      }
      return firebaseAuthMiddleware(c, next);
    });
    app.use('/certificates/*', async (c, next) => {
      if (c.req.method === 'GET' && skipAuthForVerify.test(c.req.path)) {
        return next();
      }
      return userContextMiddleware(c, next);
    });
    app.route('/certificates', createCertificatesRoutes({ db: opts.db, logger, certConfig }));

    // Admin: gestión de dispositivos Teltonika pendientes (open enrollment).
    app.use('/admin/dispositivos-pendientes/*', firebaseAuthMiddleware);
    app.use('/admin/dispositivos-pendientes/*', userContextMiddleware);
    app.route(
      '/admin/dispositivos-pendientes',
      createAdminDispositivosRoutes({ db: opts.db, logger }),
    );

    // Admin platform-wide: gestión de adelantos Cobra Hoy (ADR-029 v1 /
    // ADR-032). Auth via BOOSTER_PLATFORM_ADMIN_EMAILS allowlist dentro
    // del handler (no por role de empresa).
    app.use('/admin/cobra-hoy/*', firebaseAuthMiddleware);
    app.use('/admin/cobra-hoy/*', userContextMiddleware);
    app.route('/admin/cobra-hoy', createAdminCobraHoyRoutes({ db: opts.db, logger }));

    // Admin platform-wide: CRUD de organizaciones stakeholder (ADR-034).
    // Auth via BOOSTER_PLATFORM_ADMIN_EMAILS allowlist en el handler.
    app.use('/admin/stakeholder-orgs/*', firebaseAuthMiddleware);
    app.use('/admin/stakeholder-orgs/*', userContextMiddleware);
    app.route('/admin/stakeholder-orgs', createAdminStakeholderOrgsRoutes({ db: opts.db, logger }));

    // ADR-039 — Site Settings Runtime Configuration. Admin edita marca
    // y copy desde la PWA; demo/login/onboarding leen la versión
    // publicada via GET /public/site-settings (cache 5min).
    app.use('/admin/site-settings/*', firebaseAuthMiddleware);
    app.use('/admin/site-settings/*', userContextMiddleware);
    app.route(
      '/admin/site-settings',
      createSiteSettingsRoutes({
        db: opts.db,
        logger,
        publicAssetsBucket: config.PUBLIC_ASSETS_BUCKET,
      }),
    );
    // Endpoint público sin auth — sirve la versión publicada con cache.
    app.route('/public', createPublicSiteSettingsRoutes({ db: opts.db, logger }));

    // Admin platform-wide: re-emisión manual de DTEs Tipo 33 (ADR-024 +
    // ADR-031). Auth via BOOSTER_PLATFORM_ADMIN_EMAILS allowlist en el
    // handler. Útil tras transient errors o tras configurar Sovos.
    app.use('/admin/liquidaciones/*', firebaseAuthMiddleware);
    app.use('/admin/liquidaciones/*', userContextMiddleware);
    app.route('/admin/liquidaciones', createAdminLiquidacionesRoutes({ db: opts.db, logger }));

    // D1 — Admin seed demo (POST/DELETE). Auth platform-admin allowlist.
    app.use('/admin/seed/*', firebaseAuthMiddleware);
    app.use('/admin/seed/*', userContextMiddleware);
    app.route(
      '/admin/seed',
      createAdminSeedRoutes({ db: opts.db, firebaseAuth: opts.firebaseAuth, logger }),
    );

    // ADR-033 §8 — Admin matching backtest. Misma allowlist platform-admin.
    app.use('/admin/matching/*', firebaseAuthMiddleware);
    app.use('/admin/matching/*', userContextMiddleware);
    app.route('/admin/matching', createAdminMatchingBacktestRoutes({ db: opts.db, logger }));

    // Spec 2026-05-13 — Admin platform-wide observability dashboard
    // (costos GCP + Twilio + Workspace + uptime + capacity + forecast).
    // Auth idem otros admin/*. Feature flag OBSERVABILITY_DASHBOARD_ACTIVATED.
    const observability = buildObservabilityServices(
      {
        redisHost: config.REDIS_HOST,
        redisPort: config.REDIS_PORT,
        ...(config.REDIS_PASSWORD ? { redisPassword: config.REDIS_PASSWORD } : {}),
        redisTls: config.REDIS_TLS,
        billingExportTable: config.BILLING_EXPORT_TABLE,
        gcpProjectId: config.GOOGLE_CLOUD_PROJECT ?? 'booster-ai-494222',
        ...(config.TWILIO_ACCOUNT_SID ? { twilioAccountSid: config.TWILIO_ACCOUNT_SID } : {}),
        ...(config.TWILIO_AUTH_TOKEN ? { twilioAuthToken: config.TWILIO_AUTH_TOKEN } : {}),
        workspaceDomain: config.GOOGLE_WORKSPACE_DOMAIN,
        workspaceImpersonateEmail: config.GOOGLE_WORKSPACE_IMPERSONATE_EMAIL,
        workspaceReaderSaEmail: config.GOOGLE_WORKSPACE_READER_SA_EMAIL,
        workspacePriceMap: {
          starter: config.GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_STARTER,
          standard: config.GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_STANDARD,
          plus: config.GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_PLUS,
          enterprise: config.GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_ENTERPRISE,
        },
        monthlyBudgetUsd: config.MONTHLY_BUDGET_USD,
        observabilityDashboardActivated: config.OBSERVABILITY_DASHBOARD_ACTIVATED,
      },
      logger,
    );
    app.use('/admin/observability/*', firebaseAuthMiddleware);
    app.use('/admin/observability/*', userContextMiddleware);
    app.route(
      '/admin/observability',
      createAdminObservabilityRoutes({
        ...observability,
        logger,
      }),
    );

    // Vehículos de la empresa activa.
    app.use('/vehiculos/*', firebaseAuthMiddleware);
    app.use('/vehiculos/*', userContextMiddleware);
    app.use('/vehiculos', firebaseAuthMiddleware);
    app.use('/vehiculos', userContextMiddleware);
    app.route('/vehiculos', createVehiculosRoutes({ db: opts.db, logger }));

    // Conductores de la empresa activa (carrier). D8 — solo accesible
    // desde la interfaz transportista; el conductor mismo no consume estos
    // endpoints (su surface vive en D9 driver-only).
    app.use('/conductores/*', firebaseAuthMiddleware);
    app.use('/conductores/*', userContextMiddleware);
    app.use('/conductores', firebaseAuthMiddleware);
    app.use('/conductores', userContextMiddleware);
    app.route('/conductores', createConductoresRoutes({ db: opts.db, logger }));

    // D9 — Driver-only auth surface. `/auth/driver-activate` NO requiere
    // firebase auth previa (el driver aún no tiene Firebase user). Otros
    // endpoints de `/auth/*` futuros podrían tenerla; por eso montamos
    // este sin middleware encima.
    app.route(
      '/auth',
      createDriverAuthRoutes({ db: opts.db, firebaseAuth: opts.firebaseAuth, logger }),
    );

    // ADR-035 — Auth universal RUT + clave numérica para todos los roles.
    // `/auth/login-rut` NO requiere firebase auth previa (es el endpoint
    // que mint el custom token que el cliente usa para signInWithCustomToken).
    // Live siempre — el frontend decide cuándo usarlo según
    // `AUTH_UNIVERSAL_V1_ACTIVATED`. Coexiste con `/auth/driver-activate`.
    app.route(
      '/auth',
      createAuthUniversalRoutes({ db: opts.db, firebaseAuth: opts.firebaseAuth, logger }),
    );

    // D7b — Sucursales del shipper. Misma surface multi-tenant que vehiculos.
    app.use('/sucursales/*', firebaseAuthMiddleware);
    app.use('/sucursales/*', userContextMiddleware);
    app.use('/sucursales', firebaseAuthMiddleware);
    app.use('/sucursales', userContextMiddleware);
    app.route('/sucursales', createSucursalesRoutes({ db: opts.db, logger }));

    // D6 — Compliance: documentos de vehículo + conductor + dashboard.
    app.use('/documentos/*', firebaseAuthMiddleware);
    app.use('/documentos/*', userContextMiddleware);
    app.route('/documentos', createDocumentosRoutes({ db: opts.db, logger }));
    app.use('/cumplimiento', firebaseAuthMiddleware);
    app.use('/cumplimiento', userContextMiddleware);
    app.use('/cumplimiento/*', firebaseAuthMiddleware);
    app.use('/cumplimiento/*', userContextMiddleware);
    app.route('/cumplimiento', createCumplimientoRoutes({ db: opts.db, logger }));
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
