import type { Logger } from '@booster-ai/logger';
import { empresaOnboardingInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { hashOnboardingToken, verifyOnboardingToken } from '../services/onboarding-token.js';
import {
  EmailAlreadyInUseError,
  EmpresaRutDuplicateError,
  type OnboardingResult,
  OnboardingTokenNotConsumableError,
  OnboardingTokenRequiredError,
  PlanNotFoundError,
  SelfOnboardingDisabledError,
  UserAlreadyExistsError,
  onboardEmpresa,
} from '../services/onboarding.js';

/** Cuerpo de respuesta de un onboarding exitoso (compartido entre rutas). */
function onboardingResponseBody(result: OnboardingResult) {
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      full_name: result.user.fullName,
      phone: result.user.phone,
      rut: result.user.rut,
      is_platform_admin: result.user.isPlatformAdmin,
      status: result.user.status,
    },
    empresa: {
      id: result.empresa.id,
      legal_name: result.empresa.legalName,
      rut: result.empresa.rut,
      is_generador_carga: result.empresa.isGeneradorCarga,
      is_transportista: result.empresa.isTransportista,
      status: result.empresa.status,
    },
    membership: {
      id: result.membership.id,
      role: result.membership.role,
      status: result.membership.status,
    },
  };
}

/**
 * Routes para gestión de empresas. Monta `/onboarding`; los CRUD
 * adicionales (update profile, list members, billing) viven en slices
 * posteriores.
 *
 * La ruta `/onboarding` usa SOLO firebaseAuth (no userContext) porque el
 * user todavía no existe en la DB cuando llama acá.
 *
 * SEC-001 hotfix: el self-service onboarding está gateado por
 * `selfOnboardingEnabled` (= config `EMPRESA_SELF_ONBOARDING_ENABLED`,
 * default false). El flag se INYECTA (no se importa el módulo config) para
 * testability. Con el flag OFF, `/onboarding` retorna 403 `onboarding_disabled`
 * ANTES de cualquier escritura a DB. Ver
 * `.specs/sec-001-empresa-onboarding-gate-hotfix/spec.md`.
 */
export function createEmpresaRoutes(opts: {
  db: Db;
  logger: Logger;
  selfOnboardingEnabled: boolean;
  /** `ADMIN_PROVISIONED_ONBOARDING_ENABLED` (T1.4). Gatea `/onboarding-admin`. */
  adminProvisionedOnboardingEnabled: boolean;
  /** `ONBOARDING_TOKEN_SIGNING_SECRET` (T1.3). Requerido cuando el flag admin está ON. */
  onboardingTokenSecret?: string | undefined;
}) {
  const app = new Hono();

  app.post('/onboarding', zValidator('json', empresaOnboardingInputSchema), async (c) => {
    const claims = c.get('firebaseClaims');
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/empresas/onboarding without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }
    if (!claims.email) {
      return c.json({ error: 'firebase_email_missing', code: 'firebase_email_missing' }, 400);
    }

    // SEC-001 hotfix — gate de ruta (fail-closed ANTES de cualquier
    // escritura). Con el flag OFF, self-service onboarding queda cerrado
    // pendiente del rediseño del flujo aprobación→dueño.
    if (!opts.selfOnboardingEnabled) {
      opts.logger.warn(
        { firebaseUid: claims.uid, path: c.req.path },
        'self-service onboarding blocked (EMPRESA_SELF_ONBOARDING_ENABLED=false)',
      );
      return c.json(
        {
          error: 'onboarding_disabled',
          code: 'onboarding_disabled',
          message:
            'El alta de empresas por autoservicio está cerrada. Escribe a soporte@boosterchile.com para solicitar acceso.',
        },
        403,
      );
    }

    const input = c.req.valid('json');

    try {
      const result = await onboardEmpresa({
        db: opts.db,
        logger: opts.logger,
        firebaseUid: claims.uid,
        firebaseEmail: claims.email,
        input,
        authorizedBy: 'self_service',
        selfServiceEnabled: opts.selfOnboardingEnabled,
      });

      return c.json(onboardingResponseBody(result), 201);
    } catch (err) {
      if (err instanceof SelfOnboardingDisabledError) {
        // Defensa en profundidad: el gate de ruta arriba ya cubre este caso;
        // si se alcanza aquí, el service-layer invariant rechazó igual.
        opts.logger.warn({ path: c.req.path }, 'onboardEmpresa rejected self_service (flag off)');
        return c.json({ error: 'onboarding_disabled', code: 'onboarding_disabled' }, 403);
      }
      if (err instanceof UserAlreadyExistsError) {
        return c.json({ error: 'user_already_registered', code: 'user_already_registered' }, 409);
      }
      if (err instanceof EmailAlreadyInUseError) {
        return c.json({ error: 'email_in_use', code: 'email_in_use' }, 409);
      }
      if (err instanceof EmpresaRutDuplicateError) {
        return c.json({ error: 'rut_already_registered', code: 'rut_already_registered' }, 409);
      }
      if (err instanceof PlanNotFoundError) {
        return c.json({ error: 'invalid_plan', code: 'invalid_plan' }, 400);
      }
      opts.logger.error({ err }, 'unexpected error in /empresas/onboarding');
      throw err;
    }
  });

  // ===========================================================================
  // T1.5b — Onboarding admin-provisioned: el dueño aprobado completa su alta
  // consumiendo el token one-shot (header `x-onboarding-token`). Gates en orden
  // fail-closed; respuesta de token COLAPSADA (sin oráculo) para preservar la
  // postura anti-enumeration de SEC-001.
  // ===========================================================================
  app.post('/onboarding-admin', zValidator('json', empresaOnboardingInputSchema), async (c) => {
    const claims = c.get('firebaseClaims');
    if (!claims) {
      opts.logger.error({ path: c.req.path }, '/empresas/onboarding-admin without firebaseClaims');
      return c.json({ error: 'internal_server_error' }, 500);
    }
    if (!claims.email) {
      return c.json({ error: 'firebase_email_missing', code: 'firebase_email_missing' }, 400);
    }

    // Gate 1 — flag (fail-closed ANTES de leer el token).
    if (!opts.adminProvisionedOnboardingEnabled) {
      opts.logger.warn(
        { firebaseUid: claims.uid, path: c.req.path },
        'admin-provisioned onboarding blocked (ADMIN_PROVISIONED_ONBOARDING_ENABLED=false)',
      );
      return c.json({ error: 'onboarding_disabled', code: 'onboarding_disabled' }, 403);
    }
    // Gate 1b — fail-closed: flag ON sin secreto => 503 (no se acepta token).
    // Capturado en const local para que el narrowing a `string` sobreviva a las
    // llamadas intermedias (TS resetea narrowing de props tras function calls).
    const signingSecret = opts.onboardingTokenSecret;
    if (!signingSecret) {
      opts.logger.error(
        { path: c.req.path },
        'admin-provisioned onboarding: ADMIN_PROVISIONED_ONBOARDING_ENABLED ON pero ONBOARDING_TOKEN_SIGNING_SECRET ausente (fail-closed)',
      );
      return c.json({ error: 'service_unavailable', code: 'onboarding_misconfigured' }, 503);
    }
    // Gate 2 — emailVerified (T5). Propiedad del caller, no oráculo de existencia.
    if (!claims.emailVerified) {
      opts.logger.warn(
        { firebaseUid: claims.uid, path: c.req.path },
        'admin-provisioned onboarding: email not verified',
      );
      return c.json({ error: 'email_not_verified', code: 'email_not_verified' }, 403);
    }
    // Gate 3 — token presente (T3a). Header = bearer credential.
    const token = c.req.header('x-onboarding-token');
    if (!token) {
      return c.json({ error: 'onboarding_token_required', code: 'onboarding_token_required' }, 401);
    }

    // Verify (T1.2). Fail-closed: un secreto débil LANZA => 503 (no la respuesta
    // anti-enumeration). El route nunca pasa un no-string a verify (guard arriba).
    let verification: ReturnType<typeof verifyOnboardingToken>;
    try {
      verification = verifyOnboardingToken({ token, secret: signingSecret });
    } catch (err) {
      opts.logger.error(
        { err, path: c.req.path },
        'admin-provisioned onboarding: verifyOnboardingToken threw (weak/missing secret)',
      );
      return c.json({ error: 'service_unavailable', code: 'onboarding_misconfigured' }, 503);
    }

    // COLAPSO sin oráculo: invalid/expired (verify) + no-row/consumido/expirado
    // (consume) => UNA respuesta genérica. T3b (Google con email aprobado pero
    // sin token válido) cae acá.
    const tokenRejection = () =>
      c.json({ error: 'onboarding_token_invalid', code: 'onboarding_token_invalid' }, 403);
    if (!verification.ok) {
      opts.logger.warn(
        { firebaseUid: claims.uid, reason: verification.reason },
        'admin-provisioned onboarding: token rejected (verify)',
      );
      return tokenRejection();
    }

    const input = c.req.valid('json');

    try {
      const result = await onboardEmpresa({
        db: opts.db,
        logger: opts.logger,
        firebaseUid: claims.uid,
        firebaseEmail: claims.email,
        input,
        authorizedBy: 'admin_provisioned',
        selfServiceEnabled: opts.selfOnboardingEnabled,
        onboardingTokenConsumption: {
          solicitudId: verification.solicitudId,
          tokenHash: hashOnboardingToken(token),
        },
      });
      return c.json(onboardingResponseBody(result), 201);
    } catch (err) {
      if (err instanceof OnboardingTokenNotConsumableError) {
        // Mismo colapso que verify-fail (sin oráculo consumido/expirado/no-row).
        opts.logger.warn(
          { firebaseUid: claims.uid },
          'admin-provisioned onboarding: token not consumable',
        );
        return tokenRejection();
      }
      if (err instanceof OnboardingTokenRequiredError) {
        // No debería ocurrir (siempre pasamos consumption); fail-closed.
        opts.logger.error(
          { path: c.req.path },
          'admin-provisioned onboarding: token required (bug)',
        );
        return c.json({ error: 'internal_server_error' }, 500);
      }
      if (err instanceof UserAlreadyExistsError) {
        return c.json({ error: 'user_already_registered', code: 'user_already_registered' }, 409);
      }
      if (err instanceof EmailAlreadyInUseError) {
        return c.json({ error: 'email_in_use', code: 'email_in_use' }, 409);
      }
      if (err instanceof EmpresaRutDuplicateError) {
        return c.json({ error: 'rut_already_registered', code: 'rut_already_registered' }, 409);
      }
      if (err instanceof PlanNotFoundError) {
        return c.json({ error: 'invalid_plan', code: 'invalid_plan' }, 400);
      }
      opts.logger.error({ err }, 'unexpected error in /empresas/onboarding-admin');
      throw err;
    }
  });

  return app;
}
