import type { Context } from 'hono';
import { config as appConfig } from '../config.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Middleware guard para endpoints `/admin/*` reservados a operadores
 * Booster (no admins de empresa). Allowlist en
 * `BOOSTER_PLATFORM_ADMIN_EMAILS` (CSV configurado via Terraform var).
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
 * - 403 `forbidden_platform_admin` si email NO está en allowlist
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
   * Si está ausente, el guard solo valida auth + allowlist.
   */
  featureFlag?: boolean;
}

export function requirePlatformAdmin(
  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  c: Context<any, any, any>,
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
  const email = userContext.user.email?.toLowerCase();
  const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
  if (!email || !allowlist.includes(email)) {
    return {
      ok: false,
      response: c.json({ error: 'forbidden_platform_admin' }, 403),
    };
  }
  return { ok: true, userContext, adminEmail: email };
}
