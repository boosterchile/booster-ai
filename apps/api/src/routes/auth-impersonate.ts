import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { eventosImpersonacion, users } from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { evaluateImpersonationTarget } from '../services/impersonation.js';

/**
 * Endpoint `POST /auth/impersonate` — impersonación auditada. El TRUST
 * BOUNDARY del mecanismo: acá se decide y emite el custom token que hace que
 * la sesión del admin pase a SER el target.
 *
 * Airtight por diseño:
 *   - `requirePlatformAdmin` (featureFlag IMPERSONATION_V1_ACTIVATED + auth
 *     presente + allowlist BOOSTER_PLATFORM_ADMIN_EMAILS): solo un
 *     platform-admin activa esto; con el flag OFF responde 503.
 *   - `evaluateImpersonationTarget` (target-side): sin admin→admin, sin self,
 *     target debe existir y estar activado (Firebase UID real).
 *   - Rate-limit: se monta como middleware aparte en server.ts (per-uid,
 *     fail-closed) — ver `createRateLimitImpersonateMiddleware`.
 *   - Auditoría: cada emisión inserta una fila en `eventos_impersonacion`
 *     (admin → target → cuándo). Las mutaciones durante la sesión se atribuyen
 *     vía el log del impersonation-write-guard.
 *
 * Diseño de sesión (sellado con el PO): el token se mintea sobre el UID del
 * TARGET con el custom claim `impersonated_by = adminUserId` como claim aparte.
 * La sesión ES el target (sus empresas, validación X-Empresa-Id normal, sin
 * huecos); `impersonated_by` solo alimenta guard/auditoría/banner.
 *
 * Nota de threat-model (frontera del goal de frontend): los custom claims de
 * `createCustomToken` NO sobreviven al refresh del ID token (~1h) — el modo
 * demo los persiste con `setCustomUserClaims`, pero eso contaminaría el record
 * del target real. El PO selló "token corto": no persistimos. Consecuencia: la
 * impersonación caduca con el token; el goal de frontend define el ciclo
 * entrar/salir/re-mint. No se abre hueco para sesiones normales (nunca llevan
 * el claim).
 *
 * Respuestas:
 *   - 200 { custom_token, target_user_id, impersonated_at } — éxito.
 *   - 400 invalid_request | cannot_impersonate_self.
 *   - 401 unauthorized (sin auth) · 403 forbidden_platform_admin |
 *     forbidden_impersonate_admin · 404 target_not_found ·
 *     409 target_not_activated · 503 feature_disabled.
 *   - 502 firebase_error — createCustomToken falló (sin fila de auditoría).
 */

const impersonateBodySchema = z.object({
  target_user_id: z.string().uuid(),
});

export function createAuthImpersonateRoutes(opts: {
  db: Db;
  firebaseAuth: Auth;
  logger: Logger;
}) {
  const app = new Hono();

  app.post('/impersonate', zValidator('json', impersonateBodySchema), async (c) => {
    // Caller-side: feature flag + auth + allowlist platform-admin.
    const auth = requirePlatformAdmin(c, {
      featureFlag: appConfig.IMPERSONATION_V1_ACTIVATED,
    });
    if (!auth.ok) {
      return auth.response;
    }
    const callerUserId = auth.userContext.user.id;

    const { target_user_id: targetUserId } = c.req.valid('json');

    // Lookup del target (solo las columnas que la decisión necesita).
    const rows = await opts.db
      .select({
        id: users.id,
        firebaseUid: users.firebaseUid,
        isPlatformAdmin: users.isPlatformAdmin,
      })
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    // Target-side trust boundary (función pura).
    const decision = evaluateImpersonationTarget({
      callerUserId,
      target: rows[0] ?? null,
    });
    if (!decision.ok) {
      return c.json({ error: decision.code, code: decision.code }, decision.status);
    }

    const impersonatedAt = new Date().toISOString();

    // Mint del custom token sobre el UID del target con impersonated_by.
    let customToken: string;
    try {
      customToken = await opts.firebaseAuth.createCustomToken(decision.targetFirebaseUid, {
        impersonated_by: callerUserId,
        impersonated_at: impersonatedAt,
      });
    } catch (err) {
      opts.logger.error(
        { err, adminUserId: callerUserId, targetUserId: decision.targetUserId },
        'impersonate: createCustomToken falló',
      );
      return c.json({ error: 'firebase_error', code: 'firebase_error' }, 502);
    }

    // Auditoría: fila quién→a-quién→cuándo. La empresa activa la elige el
    // cliente vía X-Empresa-Id (puede variar), así que empresa_id queda null
    // al inicio; las mutaciones se atribuyen vía el impersonation-write-guard.
    await opts.db.insert(eventosImpersonacion).values({
      adminUserId: callerUserId,
      targetUserId: decision.targetUserId,
      empresaId: null,
    });

    // IMPORTANT: NO loguear el custom_token (credencial efímera).
    opts.logger.info(
      { adminUserId: callerUserId, targetUserId: decision.targetUserId },
      'impersonate: éxito',
    );

    return c.json({
      custom_token: customToken,
      target_user_id: decision.targetUserId,
      impersonated_at: impersonatedAt,
    });
  });

  return app;
}
