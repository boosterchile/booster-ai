import type { Logger } from '@booster-ai/logger';
import { empresaOnboardingInputSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import {
  EmailAlreadyInUseError,
  EmpresaRutDuplicateError,
  PlanNotFoundError,
  SelfOnboardingDisabledError,
  UserAlreadyExistsError,
  onboardEmpresa,
} from '../services/onboarding.js';

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

      return c.json(
        {
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
        },
        201,
      );
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

  return app;
}
