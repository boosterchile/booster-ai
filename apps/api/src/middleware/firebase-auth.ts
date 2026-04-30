import type { Logger } from '@booster-ai/logger';
import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { MiddlewareHandler } from 'hono';

/**
 * Subset de claims de un Firebase ID token que propagamos al context.
 * Equivalente al `DecodedIdToken` pero recortado para evitar exponer toda
 * la API surface de firebase-admin a los handlers.
 */
export interface FirebaseClaims {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
  name: string | undefined;
  picture: string | undefined;
  /** Custom claims que el cliente puede haber seteado (slice 2+ usa para
   * roles fast-path sin pegarle a la DB). */
  custom: Record<string, unknown>;
}

/**
 * Middleware que valida el Firebase ID token enviado por el cliente web en
 * el header `Authorization: Bearer <id_token>` y propaga las claims al
 * context para que los siguientes middlewares (userContext) lo resuelvan
 * contra la DB.
 *
 * Diferencia con el middleware OIDC SA-to-SA (apps/api/src/middleware/auth.ts):
 *   - Este es para usuarios FINALES (web/mobile) con tokens emitidos por
 *     Firebase Authentication.
 *   - El OIDC es para Cloud Run service-to-service con tokens de Google
 *     Identity para SAs.
 *
 * Ambos usan Bearer token pero las claims son distintas (Firebase: uid +
 * email + custom; OIDC SA: aud + email-of-SA + iss=accounts.google.com).
 */
export function createFirebaseAuthMiddleware(opts: {
  /**
   * Instancia de firebase-admin Auth. Inyectable para tests (stub
   * verifyIdToken sin pegar a Google).
   */
  auth: Auth;
  logger: Logger;
}): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      opts.logger.warn({ path: c.req.path }, 'Missing Firebase Bearer token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();

    let decoded: DecodedIdToken;
    try {
      // verifyIdToken hace todo el heavy lifting:
      //   - parsea JWT, valida estructura
      //   - obtiene Google JWKS específico de Firebase (cacheadas)
      //   - verifica firma RS256
      //   - valida iss = https://securetoken.google.com/<projectId>
      //   - valida aud = projectId
      //   - valida exp > now
      //   - valida sub (= uid) presente
      decoded = await opts.auth.verifyIdToken(token);
    } catch (err) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err), path: c.req.path },
        'Firebase ID token verification failed',
      );
      return c.json({ error: 'Invalid token' }, 401);
    }

    const claims: FirebaseClaims = {
      uid: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified ?? false,
      name: decoded.name,
      picture: decoded.picture,
      custom: { ...decoded },
    };

    c.set('firebaseClaims', claims);

    await next();
    return;
  };
}
