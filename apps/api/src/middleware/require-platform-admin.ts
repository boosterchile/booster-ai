import type { Context } from 'hono';
import { tieneAccesoPlataforma } from '../auth/acceso-plataforma.js';
import { config as appConfig } from '../config.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Middleware guard para endpoints `/admin/*` reservados a operadores
 * Booster (no admins de empresa). Decide con la regla única de
 * `auth/acceso-plataforma.ts` (`.specs/acceso-panel-plataforma`): la cuenta
 * marcada como personal y activa, o un correo de la lista de respaldo
 * `BOOSTER_PLATFORM_ADMIN_EMAILS` (Terraform, para el primer admin). Toda ruta
 * admin usa este guard; ninguna repite la regla.
 *
 * Patrón originalmente inline en `routes/admin-cobra-hoy.ts` +
 * `routes/admin-matching-backtest.ts` + `routes/admin-stakeholder-orgs.ts`.
 * Extraído aquí para DRY al sumar `routes/admin-observability.ts` (spec
 * 2026-05-13).
 *
 * **Patrón de uso** (return-tagged-union, no throws):
 * ```typescript
 * app.get('/some/admin/endpoint', async (c) => {
 *   const auth = requirePlatformAdmin(c, { featureFlag: appConfig.FOO_ACTIVATED });
 *   if (!auth.ok) {
 *     return auth.response;
 *   }
 *   // auth.userContext + auth.adminEmail disponibles
 * });
 * ```
 *
 * Respuestas:
 * - 503 `feature_disabled` si `featureFlag` se pasó y es false
 * - 401 `unauthorized` si no hay user context (Firebase auth missing)
 * - 403 `forbidden_platform_admin` si la cuenta no tiene acceso al panel
 */

interface RequirePlatformAdminSuccess {
  ok: true;
  userContext: UserContext;
  adminEmail: string;
}

interface RequirePlatformAdminFailure {
  ok: false;
  response: Response;
}

type RequirePlatformAdminResult = RequirePlatformAdminSuccess | RequirePlatformAdminFailure;

export interface RequirePlatformAdminOpts {
  /**
   * Si está presente y es `false`, el guard responde 503 `feature_disabled`
   * antes de chequear auth. Útil para features con kill-switch.
   * Si está ausente, el guard solo valida auth + acceso al panel.
   */
  featureFlag?: boolean;
}

export function requirePlatformAdmin(
  c: Context,
  opts: RequirePlatformAdminOpts = {},
): RequirePlatformAdminResult {
  if (opts.featureFlag === false) {
    return {
      ok: false,
      response: c.json({ error: 'feature_disabled' }, 503),
    };
  }
  const userContext = c.get('userContext') as UserContext | undefined;
  if (!userContext) {
    return { ok: false, response: c.json({ error: 'unauthorized' }, 401) };
  }
  if (!tieneAccesoPlataforma(userContext.user, appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS)) {
    return {
      ok: false,
      response: c.json({ error: 'forbidden_platform_admin' }, 403),
    };
  }
  return { ok: true, userContext, adminEmail: (userContext.user.email ?? '').toLowerCase() };
}
