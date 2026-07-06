import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import type { Auth } from 'firebase-admin/auth';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { SignupRequestNotifier } from '../services/notifications/signup-request-email.js';
import {
  approveSignupRequest,
  listPendingSignupRequests,
  rejectSignupRequest,
} from '../services/signup-request.js';
import type { UserContext } from '../services/user-context.js';

/**
 * T10 SEC-001 Sprint 2b — `/admin/signup-requests` endpoints
 * (sec-001-cierre §3 H1.2 SC-1.2.1 completion).
 *
 *   GET  /admin/signup-requests             → list pendientes
 *   POST /admin/signup-requests/:id/approve → approve via Admin SDK createUser
 *   POST /admin/signup-requests/:id/reject  → mark rechazado (no user creado)
 *
 * Audiencia: platform-admin Booster (BOOSTER_PLATFORM_ADMIN_EMAILS allowlist).
 * Auth chain (wireada en server.ts): firebaseAuthMiddleware + demoExpires +
 * isDemoEnforcement + userContext. Cada handler valida el role via
 * `requirePlatformAdmin` helper (paridad admin-stakeholder-orgs).
 *
 * Feature flag gate: si `SIGNUP_REQUEST_FLOW_ACTIVATED=false` (default),
 * todos los endpoints retornan 503 `service_unavailable` + structured log.
 * El endpoint público POST /api/v1/signup-request (T8) NO se gate por este
 * flag — solicitudes nuevas siguen siendo aceptadas y se acumulan en
 * `solicitudes_registro` hasta flip ON (spec §7.5 rollback path).
 *
 * Email notifications via `SignupRequestNotifier` inyectado (T10c). Real
 * email infra deferred a futuro spec — implementación actual es
 * `LoggingSignupRequestNotifier` (structured logs).
 */

/**
 * W1.4 (hito-2-corfo-mes-8, desviación 8) — base configurable del link de
 * onboarding que el admin copia y entrega manualmente (email real = Fase 2).
 * Debe ser https (nunca http, ni siquiera en overrides explícitos) porque el
 * token viaja como query param.
 */
const onboardingLinkBaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'onboardingLinkBaseUrl debe ser https',
  });

const approveBodySchema = z.object({
  loginLinkUrl: z.string().url().optional(),
  onboardingLinkBaseUrl: onboardingLinkBaseUrlSchema.optional(),
});

const rejectBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

const idParamSchema = z.object({ id: z.string().uuid() });

const DEFAULT_LOGIN_LINK_URL = 'https://app.boosterchile.com/login';

/**
 * W1.4 — default del base URL del link de onboarding copiable. Consistente
 * con la página consumidora `/onboarding-admin` (W1.3, `apps/web/src/router.tsx`),
 * que lee `?token=` y lo reenvía como header `x-onboarding-token`.
 */
const DEFAULT_ONBOARDING_LINK_BASE_URL = 'https://app.boosterchile.com/onboarding-admin';

/**
 * Arma el link copiable a partir del token one-shot emitido por el approve.
 * `encodeURIComponent` es defensivo (el token es base64url + un separador
 * `.`, ya URL-safe) — protege igual si el formato del token cambiara.
 */
function buildOnboardingLink(baseUrl: string | undefined, token: string): string {
  const base = baseUrl ?? DEFAULT_ONBOARDING_LINK_BASE_URL;
  return `${base}?token=${encodeURIComponent(token)}`;
}

export function createAdminSignupRequestsRoutes(opts: {
  db: Db;
  logger: Logger;
  auth: Auth;
  notifier: SignupRequestNotifier;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    if (!email || !allowlist.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, adminEmail: email };
  }

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requireFlowActivated(c: Context<any, any, any>, correlationId: string) {
    if (!appConfig.SIGNUP_REQUEST_FLOW_ACTIVATED) {
      opts.logger.info(
        { correlationId, flag: 'SIGNUP_REQUEST_FLOW_ACTIVATED' },
        'admin-signup-requests: feature flag OFF; respondiendo 503',
      );
      return {
        ok: false as const,
        response: c.json({ error: 'service_unavailable', code: 'signup_flow_disabled' }, 503),
      };
    }
    return { ok: true as const };
  }

  app.get('/', async (c) => {
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const gate = requireFlowActivated(c, correlationId);
    if (!gate.ok) {
      return gate.response;
    }

    const rows = await listPendingSignupRequests(opts.db);
    return c.json({
      signup_requests: rows.map((r) => ({
        id: r.id,
        email: r.email,
        nombre_completo: r.nombreCompleto,
        estado: r.estado,
        solicitado_en: r.solicitadoEn.toISOString(),
      })),
    });
  });

  app.post(
    '/:id/approve',
    zValidator('param', idParamSchema),
    zValidator('json', approveBodySchema),
    async (c) => {
      const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
      const auth = requirePlatformAdmin(c);
      if (!auth.ok) {
        return auth.response;
      }
      const gate = requireFlowActivated(c, correlationId);
      if (!gate.ok) {
        return gate.response;
      }
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // T1.3/T1.4 — modo admin-provisioned. Fail-closed: flag ON sin secreto
      // configurado => 503 (no caer silenciosamente al precreate viejo).
      if (
        appConfig.ADMIN_PROVISIONED_ONBOARDING_ENABLED &&
        !appConfig.ONBOARDING_TOKEN_SIGNING_SECRET
      ) {
        opts.logger.error(
          { correlationId, requestId: id },
          'admin-signup-requests.approve: ADMIN_PROVISIONED_ONBOARDING_ENABLED ON pero ONBOARDING_TOKEN_SIGNING_SECRET ausente (fail-closed)',
        );
        return c.json({ error: 'service_unavailable', code: 'onboarding_misconfigured' }, 503);
      }
      const adminProvisionedOnboarding =
        appConfig.ADMIN_PROVISIONED_ONBOARDING_ENABLED && appConfig.ONBOARDING_TOKEN_SIGNING_SECRET
          ? {
              signingSecret: appConfig.ONBOARDING_TOKEN_SIGNING_SECRET,
              ttlMs: appConfig.ONBOARDING_TOKEN_TTL_HOURS * 60 * 60 * 1000,
            }
          : undefined;

      try {
        const result = await approveSignupRequest(opts.db, opts.logger, opts.auth, opts.notifier, {
          id,
          approverEmail: auth.adminEmail,
          loginLinkUrl: body.loginLinkUrl ?? DEFAULT_LOGIN_LINK_URL,
          correlationId,
          ...(adminProvisionedOnboarding ? { adminProvisionedOnboarding } : {}),
        });
        if (result.outcome === 'not_found') {
          return c.json({ error: 'not_found', code: 'signup_request_not_found' }, 404);
        }
        if (result.outcome === 'already_processed') {
          return c.json({ error: 'conflict', code: 'signup_request_already_processed' }, 409);
        }
        if (result.outcome === 'firebase_user_already_exists') {
          return c.json({ error: 'conflict', code: 'firebase_user_already_exists' }, 409);
        }
        // W1.4 — flag ON + secret emiten `onboardingToken`/`onboardingTokenExpiresAt`
        // (ver signup-request.ts); flag OFF los deja `undefined` y la respuesta
        // queda EXACTAMENTE como antes de esta tarea (sin campos nuevos). El
        // link/token NUNCA se loguea ni se persiste acá — solo viaja en este
        // body de respuesta al admin autenticado.
        const onboardingLinkFields =
          result.onboardingToken && result.onboardingTokenExpiresAt
            ? {
                onboarding_link: buildOnboardingLink(
                  body.onboardingLinkBaseUrl,
                  result.onboardingToken,
                ),
                onboarding_link_expires_at: result.onboardingTokenExpiresAt.toISOString(),
              }
            : {};
        return c.json(
          {
            ok: true,
            outcome: 'approved',
            firebase_uid: result.firebaseUid,
            user_id: result.userId,
            ...onboardingLinkFields,
          },
          200,
        );
      } catch (err) {
        opts.logger.error(
          { err, correlationId, requestId: id },
          'admin-signup-requests.approve: unexpected error',
        );
        return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
      }
    },
  );

  app.post(
    '/:id/reject',
    zValidator('param', idParamSchema),
    zValidator('json', rejectBodySchema),
    async (c) => {
      const correlationId = c.req.header('x-correlation-id') ?? randomUUID();
      const auth = requirePlatformAdmin(c);
      if (!auth.ok) {
        return auth.response;
      }
      const gate = requireFlowActivated(c, correlationId);
      if (!gate.ok) {
        return gate.response;
      }
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      try {
        const result = await rejectSignupRequest(opts.db, opts.logger, opts.notifier, {
          id,
          approverEmail: auth.adminEmail,
          ...(body.reason ? { reason: body.reason } : {}),
          correlationId,
        });
        if (result.outcome === 'not_found') {
          return c.json({ error: 'not_found', code: 'signup_request_not_found' }, 404);
        }
        if (result.outcome === 'already_processed') {
          return c.json({ error: 'conflict', code: 'signup_request_already_processed' }, 409);
        }
        return c.json({ ok: true, outcome: 'rejected' }, 200);
      } catch (err) {
        opts.logger.error(
          { err, correlationId, requestId: id },
          'admin-signup-requests.reject: unexpected error',
        );
        return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
      }
    },
  );

  return app;
}
