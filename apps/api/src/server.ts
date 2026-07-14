import { buildRedisTlsOptions } from '@booster-ai/config';
import { type Logger, createLogger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import Redis from 'ioredis';
import type pg from 'pg';
import { config } from './config.js';
import type { Db } from './db/client.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createDemoExpiresMiddleware } from './middleware/demo-expires.js';
import { createFirebaseAuthMiddleware } from './middleware/firebase-auth.js';
import { createImpersonationWriteGuardMiddleware } from './middleware/impersonation-write-guard.js';
import { ALLOWLISTED_PATHS } from './middleware/is-demo-allowlist.js';
import { createIsDemoEnforcementMiddleware } from './middleware/is-demo-enforcement.js';
import { createRateLimitImpersonateMiddleware } from './middleware/rate-limit-impersonate.js';
import { createRateLimitPinMiddleware } from './middleware/rate-limit-pin.js';
import { createRateLimitPublicTrackingMiddleware } from './middleware/rate-limit-public-tracking.js';
import { createRateLimitSignupMiddleware } from './middleware/rate-limit-signup.js';
import { createRateLimitTransportDocumentsMiddleware } from './middleware/rate-limit-transport-documents.js';
import { skipPublicVerify } from './middleware/skip-public-verify.js';
import { createUserContextMiddleware } from './middleware/user-context.js';
import { createAdminBackfillDistanciaRoutes } from './routes/admin-backfill-distancia.js';
import { createAdminCobraHoyRoutes } from './routes/admin-cobra-hoy.js';
import { createAdminDispositivosRoutes } from './routes/admin-dispositivos.js';
import { createAdminJobsRoutes } from './routes/admin-jobs.js';
import { createAdminMatchingBacktestRoutes } from './routes/admin-matching-backtest.js';
import { createAdminObservabilityRoutes } from './routes/admin-observability.js';
import { createAdminSignupRequestsRoutes } from './routes/admin-signup-requests.js';
import { createAdminStakeholderOrgsRoutes } from './routes/admin-stakeholder-orgs.js';
import { createAssignmentsRoutes } from './routes/assignments.js';
import { createDriverAuthRoutes } from './routes/auth-driver.js';
import { createAuthImpersonateRoutes } from './routes/auth-impersonate.js';
import { createAuthUniversalRoutes } from './routes/auth-universal.js';
import { createCertificatesRoutes } from './routes/certificates.js';
import { createChatRoutes } from './routes/chat.js';
import { createCobraHoyAssignmentsRoutes, createCobraHoyMeRoutes } from './routes/cobra-hoy.js';
import { createConductoresRoutes } from './routes/conductores.js';
import { createDemoCacheWarmRoutes } from './routes/demo-cache-warm.js';
import { createCumplimientoRoutes, createDocumentosRoutes } from './routes/documentos.js';
import { createEmpresaRoutes } from './routes/empresas.js';
import { createFeatureFlagsRoutes } from './routes/feature-flags.js';
import { createHealthSignupFlowRouter } from './routes/health-signup-flow.js';
import { createHealthRouter } from './routes/health.js';
import { createInternalSafetyEventsRoutes } from './routes/internal-safety-events.js';
import { createMeClaveNumericaRoutes } from './routes/me-clave-numerica.js';
import { createMeConsentsRoutes } from './routes/me-consents.js';
import { createMeLiquidacionesRoutes } from './routes/me-liquidaciones.js';
import { createMeRoutes } from './routes/me.js';
import { createOfferRoutes } from './routes/offers.js';
import { createPublicTrackingRoutes } from './routes/public-tracking.js';
import { createSignupRequestRoutes } from './routes/signup-request.js';
import {
  createPublicSiteSettingsRoutes,
  createSiteSettingsRoutes,
} from './routes/site-settings.js';
import { createStakeholderZonasRoutes } from './routes/stakeholder-zonas.js';
import { createSucursalesRoutes } from './routes/sucursales.js';
import { createTransportDocumentsRoutes } from './routes/transport-documents.js';
import { createTripRequestsV2Routes } from './routes/trip-requests-v2.js';
import { createTripRequestsRoutes } from './routes/trip-requests.js';
import { createVehiculosRoutes } from './routes/vehiculos.js';
import { createMePushSubscriptionRoutes, createWebpushPublicRoutes } from './routes/webpush.js';
import {
  cargarCandidatosBackfill,
  contarCandidatosBackfill,
  persistirBackfill,
  reconstruirTripBackfill,
} from './services/backfill-distancia-adapters.js';
import { ejecutarBackfill } from './services/backfill-distancia-real.js';
import { LoggingSignupRequestNotifier } from './services/notifications/signup-request-email.js';
import type { NotifyOfferDeps } from './services/notify-offer.js';
import type { NotifyTrackingLinkDeps } from './services/notify-tracking-link.js';
import { buildObservabilityServices } from './services/observability/factory.js';
import { consumeStreamTicket } from './services/sse-ticket.js';
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

  // T9 SEC-001 — cliente Redis dedicado al rate-limit-pin middleware.
  // Conexión propia (no comparte pool con ObservabilityCache) para
  // aislar métricas y errores. lazyConnect=true evita crashear el
  // startup si Memorystore está unreachable; el middleware loguea el
  // error y fail-closea con 503 (rate-limit-pin / rate-limit-signup).
  const rateLimitRedisTls = buildRedisTlsOptions({
    tls: config.REDIS_TLS,
    caCert: config.REDIS_CA_CERT,
    requireCa: config.NODE_ENV === 'production',
  });
  const redisForRateLimit = new Redis({
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    ...(config.REDIS_PASSWORD ? { password: config.REDIS_PASSWORD } : {}),
    ...(rateLimitRedisTls ? { tls: rateLimitRedisTls } : {}),
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  redisForRateLimit.on('error', (err) => {
    logger.warn({ err: err.message }, 'rate-limit-pin: Redis error');
  });

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

  // T8 SEC-001 Sprint 2b — GET /health/signup-flow liveness probe específico
  // para el synthetic monitor `signup-probe` (T13 SC-1.2.3). Sin DB ni Redis;
  // solo verifica que el route está montado y el proceso vivo. Distinguible
  // de /health para alerting fino post-deploy.
  app.route('/health', createHealthSignupFlowRouter());

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

  // POST /demo/login (modo demo subdominio) RETIRADO — chore/retiro-subsistema-demo.
  if (opts.firebaseAuth) {
    // T5 SEC-001 Sprint 2a — GET /api/v1/demo/cache-warm/:persona
    // (pre-warm del cache del middleware demo-expires, llamado fire-
    // and-forget desde el landing demo). IP rate-limited inline (10/
    // min/IP). Public — no firebase auth required.
    app.route(
      '/api/v1/demo',
      createDemoCacheWarmRoutes({
        db: opts.db,
        auth: opts.firebaseAuth,
        redis: redisForRateLimit,
        logger,
      }),
    );
  }

  // T8 SEC-001 Sprint 2b — POST /api/v1/signup-request (SC-1.2.1 + SC-1.2.5
  // + ADR-052). Endpoint público (sin firebase auth) que reemplaza el flow
  // `createUserWithEmailAndPassword` client-side por admin-approval gate.
  //
  // Order CRITICAL: rate-limit middleware se monta ANTES del route para que
  // toda request al path pase por el counter 5/15min/IP (fail-closed 503 si
  // Redis down). Sin esto, attacker podría flood el INSERT a la tabla
  // solicitudes_registro. Cloud Armor cascade (1000/min/IP) actúa como
  // pre-filtro upstream — ver docs/qa/rate-limit-cascade.md.
  //
  // Allowlist entry `POST /api/v1/signup-request` ya preempty en T3
  // is-demo-allowlist.ts (sin claim is_demo en path público; defense para
  // evitar 403 si wire global futuro aplica).
  const rateLimitSignup = createRateLimitSignupMiddleware({
    redis: redisForRateLimit,
    logger,
  });
  app.use('/api/v1/signup-request', rateLimitSignup);
  app.route('/api/v1/signup-request', createSignupRequestRoutes({ db: opts.db, logger }));

  // Phase 5 PR-L1 — Public tracking del shipper / consignee. NO auth:
  // la defensa es la opacidad del token UUID v4 (122 bits, no enumerable).
  // El handler restringe los datos expuestos (plate parcial, sin
  // driver name, telemetría sólo <30min).
  //
  // ADR-038: Routes API via ADC. Pasamos GOOGLE_CLOUD_PROJECT en lugar
  // de API key — el SA del runtime se autentica via workload identity, y
  // el projectId va en X-Goog-User-Project. Si la env var está ausente,
  // fallback transparente al ETA al centroide regional (PR-L2b).
  //
  // P1-4 (audit 2026-06-14): rate-limit per-IP (60/60s, fail-closed 503 si
  // Redis down) ANTES del handler — el endpoint es público sin auth y sin cap
  // un atacante podía enumerar tokens o agotar recursos (lookup DB + Routes
  // API por hit). Mismo patrón que signup-request. Cloud Armor cascade actúa
  // como pre-filtro upstream — docs/qa/rate-limit-cascade.md.
  const rateLimitPublicTracking = createRateLimitPublicTrackingMiddleware({
    redis: redisForRateLimit,
    logger,
  });
  app.use('/public/tracking/*', rateLimitPublicTracking);
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

  // Endpoint interno: POST /internal/safety-events (Task 10).
  // Auth propia vía OIDC (Pub/Sub push SA). NO usa firebaseAuthMiddleware.
  // Excluido del CI gate `check-is-demo-wire-completeness` (no requiere is_demo).
  const safetyTwilioClient = opts.notify?.twilioClient ?? null;
  app.route(
    '/internal/safety-events',
    createInternalSafetyEventsRoutes({
      db: opts.db,
      redis: redisForRateLimit,
      logger,
      config: {
        safetyPushCallerSa: config.SAFETY_PUSH_CALLER_SA,
        apiAudience: config.API_AUDIENCE,
        contentSidSafetyAlert: config.CONTENT_SID_SAFETY_ALERT,
      },
      sendWhatsapp: safetyTwilioClient
        ? (a) => safetyTwilioClient.sendContent(a)
        : async (a) => {
            logger.warn({ to: a.to }, 'internal-safety-events: whatsapp no configurado, skip');
          },
    }),
  );

  // End-user routes (Firebase ID token required). /me es especial: no usa
  // userContext middleware porque el user puede no existir aún en la DB
  // (post-signup pre-onboarding).
  if (opts.firebaseAuth) {
    const firebaseAuthMiddleware = createFirebaseAuthMiddleware({
      auth: opts.firebaseAuth,
      logger,
      // SSE de chat: se autentica con ticket efímero por query (no el Firebase
      // ID token, que se filtraba a Cloud Trace/Logging — fix-sse-ticket-auth).
      sseTicketStore: (ticket, assignmentId) =>
        consumeStreamTicket({ redis: redisForRateLimit, ticket, assignmentId }),
    });
    // T5 SEC-001 Sprint 2a — demo-expires middleware. Aplicado DESPUÉS
    // de firebase-auth en cada path: lee firebaseClaims del context y
    // enforce expires_at + disabled state para sessions con is_demo:
    // true. Passthrough zero-cost para cuentas no-demo (mayor parte
    // del tráfico). Fail-closed Firebase/Redis → 503. Spec §3 H1.1
    // SC-1.1.2b + SC-1.1.2c + SC-1.1.3.
    const demoExpiresMiddleware = createDemoExpiresMiddleware({
      auth: opts.firebaseAuth,
      redis: redisForRateLimit,
      logger,
    });
    // T3 SEC-001 Sprint 2b — is-demo-enforcement middleware. Defense-in-
    // depth structural enforcement del claim is_demo. Chained post-
    // firebase-auth + demo-expires en cada mount point auth-required.
    // Mode requireNotDemo: GET/HEAD/OPTIONS passthrough; POST/PUT/PATCH/
    // DELETE → 403 forbidden_demo si is_demo:true. Allowlist
    // populated en is-demo-allowlist.ts es preempty defense para
    // paths públicos (sin claim is_demo el middleware passthrough by
    // design). Spec sec-001-cierre §3 SC-1.3.2 (v3.4 amendment A1
    // 2026-05-25). Wire enumera 22 grupos per plan T3 acceptance +
    // CI gate check-is-demo-wire-completeness.ts valida coverage.
    const isDemoEnforcementMiddleware = createIsDemoEnforcementMiddleware({
      mode: 'requireNotDemo',
      allowlist: ALLOWLISTED_PATHS,
      logger,
    });
    // Impersonación auditada: guard de escritura. Se monta per-group DESPUÉS de
    // userContext (necesita activeMembership.empresa.isDemo para permitir
    // escrituras demo). En grupos sin userContext (/me raíz, /empresas
    // onboarding) fail-closea toda mutación impersonada. Cobertura garantizada
    // por el CI gate check-impersonation-wire-completeness.ts.
    const impersonationWriteGuardMiddleware = createImpersonationWriteGuardMiddleware({ logger });
    app.use('/me', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
    app.use('/me/*', firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
    // /me raíz + sub-paths: sin userContext acá → el guard fail-closea las
    // mutaciones impersonadas (no se puede cambiar clave/consents/perfil del
    // target mientras se impersona).
    app.use('/me', impersonationWriteGuardMiddleware);
    app.use('/me/*', impersonationWriteGuardMiddleware);
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
    // Stakeholder geo aggregations k-anonimizadas (gap B2 / D11, ADR-041 +
    // ADR-042). GET /me/stakeholder/zonas/:slug/agregaciones. Sólo requiere
    // firebaseAuth — el handler resuelve userId vía firebase_uid y enforce
    // RBAC rol stakeholder_sostenibilidad + gate k-anon dataset-level.
    meRouter.route('/stakeholder', createStakeholderZonasRoutes({ db: opts.db, logger }));
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
    app.use(
      '/empresas/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    // Sin userContext (onboarding) → fail-closed: bloquea onboarding impersonado.
    app.use('/empresas/*', impersonationWriteGuardMiddleware);
    app.route(
      '/empresas',
      createEmpresaRoutes({
        db: opts.db,
        logger,
        selfOnboardingEnabled: config.EMPRESA_SELF_ONBOARDING_ENABLED,
        adminProvisionedOnboardingEnabled: config.ADMIN_PROVISIONED_ONBOARDING_ENABLED,
        onboardingTokenSecret: config.ONBOARDING_TOKEN_SIGNING_SECRET,
      }),
    );

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

    // Política de cierre flexible documental (ADR-070, F4-4a). Compartida por
    // los dos endpoints de cierre (shipper confirmar-recepcion + carrier POD).
    // `requireDocumentSince` parsea la env ISO date a Date UTC; si está ausente
    // queda null y el guard NO aplica precondición aunque el flag esté ON
    // (defensa contra bloquear viajes en ruta antes de definir el corte).
    const documentClosePolicy = {
      requireDocumentToClose: config.REQUIRE_DOCUMENT_TO_CLOSE,
      requireTedDecode: config.REQUIRE_TED_DECODE,
      requireDocumentSince: config.REQUIRE_DOCUMENT_TO_CLOSE_SINCE
        ? new Date(`${config.REQUIRE_DOCUMENT_TO_CLOSE_SINCE}T00:00:00.000Z`)
        : null,
    };

    app.use(
      '/trip-requests-v2/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/trip-requests-v2/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route(
      '/trip-requests-v2',
      createTripRequestsV2Routes({
        db: opts.db,
        logger,
        certConfig,
        documentClosePolicy,
        ...(opts.notify ? { notify: opts.notify } : {}),
      }),
    );

    // Offers — endpoints carrier-side: GET mine + POST accept/reject.
    // Mismo chain firebaseAuth + userContext.
    app.use(
      '/offers/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/offers/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route(
      '/offers',
      createOfferRoutes({
        db: opts.db,
        logger,
        ...(opts.notifyTrackingLink ? { notifyTrackingLink: opts.notifyTrackingLink } : {}),
      }),
    );

    // Repositorio documental de transporte (ADR-070, frente F4-4a). Mismo
    // chain firebaseAuth + userContext: el generador de carga (dueño) o el
    // transportista asignado suben/listan/corrigen/descargan documentos
    // tributarios de terceros que amparan la carga de una orden. La
    // autorización por tenant (shipper-owner | carrier-assigned) la resuelve
    // el handler contra `viajes`/`asignaciones`. El worker decodificador del
    // TED es de la sub-fase 4b.
    const transportDocsRouter = createTransportDocumentsRoutes({
      db: opts.db,
      logger,
      ...(config.TRANSPORT_DOCUMENTS_BUCKET
        ? { transportDocumentsBucket: config.TRANSPORT_DOCUMENTS_BUCKET }
        : {}),
      ...(config.DOCUMENT_UPLOADED_TOPIC
        ? { documentUploadedTopic: config.DOCUMENT_UPLOADED_TOPIC }
        : {}),
    });
    // Review F4-4a finding 5 — rate-limit per-user (uid) / fallback-IP de las
    // ESCRITURAS (POST), fail-closed 503 si Redis down. Se monta DESPUÉS de
    // firebaseAuth (necesita `firebaseClaims.uid`) y antes del handler. Las
    // lecturas (GET) lo atraviesan sin consumir cuota. 20 escrituras/60s.
    const rateLimitTransportDocs = createRateLimitTransportDocumentsMiddleware({
      redis: redisForRateLimit,
      logger,
    });
    for (const prefix of ['/transport-orders/*', '/documents/*']) {
      app.use(prefix, firebaseAuthMiddleware, demoExpiresMiddleware, isDemoEnforcementMiddleware);
      app.use(prefix, rateLimitTransportDocs);
      app.use(prefix, userContextMiddleware, impersonationWriteGuardMiddleware);
    }
    app.route('/', transportDocsRouter);

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
          // T6a SEC-001 Sprint 2a — TTL alerter wire (firebase + redis).
          firebaseAuth: opts.firebaseAuth ?? null,
          redis: redisForRateLimit,
          // T9 SEC-001 boundary-closure — pool para el reaper de cuentas IdP.
          pool: opts.pool,
          // Gap B5 — cron de membresías. No inyectamos gateway: el route usa
          // `noopMembershipPaymentGateway` por default (⚠️ STUB, NO mueve
          // dinero). Cuando exista `payment-provider`, inyectar el real acá.
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
    app.use(
      '/assignments/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/assignments/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    const assignmentsRouter = createAssignmentsRoutes({
      db: opts.db,
      logger,
      certConfig,
      // Cierre flexible documental (ADR-070, F4-4a) en el POD del carrier.
      documentClosePolicy,
      // ADR-038: Routes API via ADC. GOOGLE_CLOUD_PROJECT va como
      // X-Goog-User-Project. Sin él, GET /assignments/:id/eco-route
      // devuelve polyline_encoded=null con status='no_routes_api_key'.
      ...(config.GOOGLE_CLOUD_PROJECT ? { routesProjectId: config.GOOGLE_CLOUD_PROJECT } : {}),
    });
    const chatRouter = createChatRoutes({
      db: opts.db,
      logger,
      webAppUrl: config.WEB_APP_URL,
      // Redis para emitir los tickets efímeros del SSE (fix-sse-ticket-auth).
      redis: redisForRateLimit,
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
    // skipPublicVerify (middleware/skip-public-verify.ts, testeado) aplica
    // el short-circuit del path público GET /verify a cada middleware del
    // chain. demoExpires cierra el gap Sprint 2c track-1 (auditoría
    // 2026-06-09): una sesión demo expirada podía seguir listando
    // certificados en este mount.
    app.use('/certificates/*', skipPublicVerify(firebaseAuthMiddleware));
    app.use('/certificates/*', skipPublicVerify(demoExpiresMiddleware));
    app.use('/certificates/*', skipPublicVerify(userContextMiddleware));
    // T3 SEC-001 Sprint 2b — is-demo-enforcement aplicado a /certificates/*.
    // Para /verify path público, firebaseAuth ya hizo short-circuit a next()
    // sin setear claims → middleware passthrough (isDemoTrueClaim retorna
    // false cuando claims ausentes). Para paths auth-required, claims sí
    // están seteadas → mode requireNotDemo enforces. No wrapper conditional
    // necesario porque el middleware self-handles ambos casos.
    app.use('/certificates/*', isDemoEnforcementMiddleware);
    // Guard tras userContext, con el mismo short-circuit del /verify público.
    app.use('/certificates/*', skipPublicVerify(impersonationWriteGuardMiddleware));
    app.route('/certificates', createCertificatesRoutes({ db: opts.db, logger, certConfig }));

    // Admin: gestión de dispositivos Teltonika pendientes (open enrollment).
    app.use(
      '/admin/dispositivos-pendientes/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use(
      '/admin/dispositivos-pendientes/*',
      userContextMiddleware,
      impersonationWriteGuardMiddleware,
    );
    app.route(
      '/admin/dispositivos-pendientes',
      createAdminDispositivosRoutes({ db: opts.db, logger }),
    );

    // Admin platform-wide: gestión de adelantos Cobra Hoy (ADR-029 v1 /
    // ADR-032). Auth via BOOSTER_PLATFORM_ADMIN_EMAILS allowlist dentro
    // del handler (no por role de empresa).
    app.use(
      '/admin/cobra-hoy/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/cobra-hoy/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/admin/cobra-hoy', createAdminCobraHoyRoutes({ db: opts.db, logger }));

    // Admin platform-wide: CRUD de organizaciones stakeholder (ADR-034).
    // Auth via BOOSTER_PLATFORM_ADMIN_EMAILS allowlist en el handler.
    app.use(
      '/admin/stakeholder-orgs/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/stakeholder-orgs/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/admin/stakeholder-orgs', createAdminStakeholderOrgsRoutes({ db: opts.db, logger }));

    // T10 SEC-001 Sprint 2b — admin signup-requests (ADR-052 + SC-1.2.1).
    // Mismo middleware chain que stakeholder-orgs + allowlist check downstream.
    // Feature flag SIGNUP_REQUEST_FLOW_ACTIVATED gate dentro del handler.
    // Allowlist entries (GET /admin/signup-requests, POST approve, POST reject)
    // en is-demo-allowlist.ts con rationale "admin-only mutation; role check
    // upstream garantiza no-demo".
    app.use(
      '/admin/signup-requests/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/signup-requests/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route(
      '/admin/signup-requests',
      createAdminSignupRequestsRoutes({
        db: opts.db,
        logger,
        auth: opts.firebaseAuth,
        notifier: new LoggingSignupRequestNotifier(logger),
      }),
    );

    // ADR-039 — Site Settings Runtime Configuration. Admin edita marca
    // y copy desde la PWA; demo/login/onboarding leen la versión
    // publicada via GET /public/site-settings (cache 5min).
    app.use(
      '/admin/site-settings/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/site-settings/*', userContextMiddleware, impersonationWriteGuardMiddleware);
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

    // D1 — Admin seed demo (POST/DELETE /admin/seed/demo) RETIRADO —
    // chore/retiro-subsistema-demo (el seed y deleteDemo se eliminaron).

    // ADR-033 §8 — Admin matching backtest. Misma allowlist platform-admin.
    app.use(
      '/admin/matching/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/matching/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/admin/matching', createAdminMatchingBacktestRoutes({ db: opts.db, logger }));

    // F0-0 paso 1 — backfill de re-derivación de distancia real. Gate
    // platform-admin (allowlist), NO /admin/jobs (SA de cron) ni JWT genérico:
    // reescribe la huella de toda la flota. Default dry-run; escritura exige
    // confirmación explícita + conteo que coincide.
    app.use(
      '/admin/backfill-distancia/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use(
      '/admin/backfill-distancia/*',
      userContextMiddleware,
      impersonationWriteGuardMiddleware,
    );
    const backfillDistanciaProjectId = config.GOOGLE_CLOUD_PROJECT;
    app.route(
      '/admin/backfill-distancia',
      createAdminBackfillDistanciaRoutes({
        logger,
        contarCandidatos: () => contarCandidatosBackfill(opts.db),
        correrBackfill: (dryRun) =>
          ejecutarBackfill({
            logger,
            dryRun,
            cargarCandidatos: (cursor, limite) => cargarCandidatosBackfill(opts.db, cursor, limite),
            reconstruir: (candidato) =>
              reconstruirTripBackfill({
                db: opts.db,
                logger,
                routesProjectId: backfillDistanciaProjectId,
                candidato,
              }),
            persistir: (r) => persistirBackfill(opts.db, r),
          }),
      }),
    );

    // Spec 2026-05-13 — Admin platform-wide observability dashboard
    // (costos GCP + Twilio + Workspace + uptime + capacity + forecast).
    // Auth idem otros admin/*. Feature flag OBSERVABILITY_DASHBOARD_ACTIVATED.
    const observability = buildObservabilityServices(
      {
        redisHost: config.REDIS_HOST,
        redisPort: config.REDIS_PORT,
        ...(config.REDIS_PASSWORD ? { redisPassword: config.REDIS_PASSWORD } : {}),
        redisTls: config.REDIS_TLS,
        ...(config.REDIS_CA_CERT ? { redisCaCert: config.REDIS_CA_CERT } : {}),
        // audit 2026-06-14 P0-D: sin fallback a un project/billing de prod
        // hardcodeado. Cuando OBSERVABILITY_DASHBOARD_ACTIVATED=true, el
        // superRefine de config.ts garantiza que ambos estén presentes; el ''
        // solo aplica con el dashboard apagado (las rutas devuelven 503 y los
        // services nunca consultan).
        billingExportTable: config.BILLING_EXPORT_TABLE ?? '',
        gcpProjectId: config.GOOGLE_CLOUD_PROJECT ?? '',
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
    app.use(
      '/admin/observability/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/admin/observability/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route(
      '/admin/observability',
      createAdminObservabilityRoutes({
        ...observability,
        logger,
      }),
    );

    // Vehículos de la empresa activa.
    app.use(
      '/vehiculos/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/vehiculos/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use(
      '/vehiculos',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/vehiculos', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/vehiculos', createVehiculosRoutes({ db: opts.db, logger }));

    // Conductores de la empresa activa (carrier). D8 — solo accesible
    // desde la interfaz transportista; el conductor mismo no consume estos
    // endpoints (su surface vive en D9 driver-only).
    app.use(
      '/conductores/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/conductores/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use(
      '/conductores',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/conductores', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/conductores', createConductoresRoutes({ db: opts.db, logger }));

    // D9 — Driver-only auth surface. `/auth/driver-activate` NO requiere
    // firebase auth previa (el driver aún no tiene Firebase user). Otros
    // endpoints de `/auth/*` futuros podrían tenerla; por eso montamos
    // este sin middleware encima.
    //
    // T9 SEC-001 — rate-limit-pin middleware (5/15min/RUT, key
    // `rl:pin-activate:<rutCanonical>`) wireado dentro de
    // createDriverAuthRoutes vía opts.rateLimitPin. La instancia Redis
    // viene de `redisForRateLimit` arriba; comparte Memorystore con el
    // resto del proceso pero es una conexión propia (aislamiento de
    // pool y métricas).
    const rateLimitPin = createRateLimitPinMiddleware({
      redis: redisForRateLimit,
      logger,
    });
    app.route(
      '/auth',
      createDriverAuthRoutes({
        db: opts.db,
        firebaseAuth: opts.firebaseAuth,
        logger,
        rateLimitPin,
      }),
    );

    // ADR-035 — Auth universal RUT + clave numérica para todos los roles.
    // `/auth/login-rut` NO requiere firebase auth previa (es el endpoint
    // que mint el custom token que el cliente usa para signInWithCustomToken).
    // Live siempre — el frontend decide cuándo usarlo según
    // `AUTH_UNIVERSAL_V1_ACTIVATED`. Coexiste con `/auth/driver-activate`.
    // Rate-limit propio (prefijos rl:login-rut, spec sec-rate-limit-login-rut):
    // la clave de 6 dígitos exige brute-force protection per ADR-035 Alt-3;
    // counters separados de driver-activate, misma conexión Redis.
    const rateLimitLogin = createRateLimitPinMiddleware({
      redis: redisForRateLimit,
      logger,
      keyPrefix: 'rl:login-rut:',
      ipKeyPrefix: 'rl:login-rut:ip:',
    });
    app.route(
      '/auth',
      createAuthUniversalRoutes({
        db: opts.db,
        firebaseAuth: opts.firebaseAuth,
        logger,
        rateLimitLogin,
      }),
    );

    // Impersonación auditada — POST /auth/impersonate (mint) + GET
    // /auth/impersonate/targets (picker). A diferencia de login-rut/
    // driver-activate (pre-auth), estos endpoints SÍ requieren que el ADMIN
    // esté autenticado (firebaseAuth + userContext, que requirePlatformAdmin
    // consume). El chain cubre el path exacto (mint) y el sub-path (targets).
    // Rate-limit per-admin-uid SOLO sobre el mint (el GET del picker es
    // read-only y no debe consumir la cuota de emisión). El guard de escritura
    // pasa directo acá (la sesión del admin no lleva impersonated_by), pero se
    // incluye para satisfacer la cobertura del gate sin excepciones.
    const rateLimitImpersonate = createRateLimitImpersonateMiddleware({
      redis: redisForRateLimit,
      logger,
    });
    app.use(
      '/auth/impersonate',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use(
      '/auth/impersonate/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/auth/impersonate', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use('/auth/impersonate/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use('/auth/impersonate', rateLimitImpersonate);
    app.route(
      '/auth',
      createAuthImpersonateRoutes({
        db: opts.db,
        firebaseAuth: opts.firebaseAuth,
        logger,
      }),
    );

    // D7b — Sucursales del shipper. Misma surface multi-tenant que vehiculos.
    app.use(
      '/sucursales/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/sucursales/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use(
      '/sucursales',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/sucursales', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/sucursales', createSucursalesRoutes({ db: opts.db, logger }));

    // D6 — Compliance: documentos de vehículo + conductor + dashboard.
    app.use(
      '/documentos/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/documentos/*', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.route('/documentos', createDocumentosRoutes({ db: opts.db, logger }));
    app.use(
      '/cumplimiento',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/cumplimiento', userContextMiddleware, impersonationWriteGuardMiddleware);
    app.use(
      '/cumplimiento/*',
      firebaseAuthMiddleware,
      demoExpiresMiddleware,
      isDemoEnforcementMiddleware,
    );
    app.use('/cumplimiento/*', userContextMiddleware, impersonationWriteGuardMiddleware);
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
