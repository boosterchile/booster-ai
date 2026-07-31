import type { MiddlewareHandler } from 'hono';

/**
 * Path del alta autocontenida: `POST /empresas/onboarding-admin`.
 *
 * Anclado a ambos extremos para que no matchee sub-paths (`…/otra`) ni
 * mounts ajenos que terminen igual.
 */
export const ONBOARDING_ADMIN_PATH = /^\/empresas\/onboarding-admin$/;

/**
 * Envuelve un middleware del chain de `/empresas/*` con short-circuit para el
 * alta autocontenida (alta-cliente-autocontenida SC1).
 *
 * **Por qué existe**: ese endpoint se completa con el token one-shot como
 * única credencial. Quien lo usa es, por definición, alguien que todavía no
 * existe en la plataforma — no tiene sesión Firebase que ofrecer, y exigirla
 * lo mandaba a un password reset + `/login?legacy=1`, camino que ADR-035 sacó
 * de la pantalla principal.
 *
 * **Qué NO afecta**: el resto de `/empresas/*` (incluido el self-service
 * viejo, cerrado por SEC-001) mantiene el chain completo. La excepción es por
 * método + path exacto: un GET al mismo path sigue pasando por auth.
 *
 * Mismo patrón que `skipPublicVerify` para el verificador de certificados.
 */
export function skipOnboardingAdmin(mw: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'POST' && ONBOARDING_ADMIN_PATH.test(c.req.path)) {
      return next();
    }
    return mw(c, next);
  };
}
