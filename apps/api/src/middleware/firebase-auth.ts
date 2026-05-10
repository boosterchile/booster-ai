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
    // Path normal: token en header Authorization. Cubre 99% de los casos.
    const authHeader = c.req.header('authorization');
    let token: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim();
    } else if (
      // Fallback: token en query param `?auth=...`. Solo para endpoints
      // SSE (EventSource del browser no soporta headers custom). Estricto:
      // solo aceptamos query auth en paths que terminan en `/stream` y
      // método GET. Cualquier otro endpoint con `?auth=` lo ignoramos —
      // si no hay header, devolvemos 401.
      c.req.method === 'GET' &&
      c.req.path.endsWith('/stream')
    ) {
      const queryAuth = c.req.query('auth');
      if (queryAuth) {
        token = queryAuth;
      }
    }

    if (!token) {
      opts.logger.warn({ path: c.req.path }, 'Missing Firebase Bearer token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

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
      //
      // Segundo argumento `checkRevoked = true` (ADR-028 §"Token revocation"):
      // verifica que el token no haya sido emitido antes de
      // `auth.revokeRefreshTokens(uid)`. Cuando un user es desactivado el
      // service `desactivarUsuario()` llama esa API; cualquier ID token previo
      // se rechaza dentro de ~1s. Costo: +1 round-trip Admin SDK al
      // user-record (cacheado internamente por firebase-admin).
      decoded = await opts.auth.verifyIdToken(token, true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Firebase emite código `auth/id-token-revoked` cuando checkRevoked
      // detecta que el token fue revocado por `revokeRefreshTokens`. Lo
      // distinguimos del expirado para alerting y debugging.
      const isRevoked =
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'auth/id-token-revoked';
      opts.logger.warn(
        { err: errMsg, path: c.req.path, revoked: isRevoked },
        isRevoked
          ? 'Firebase ID token revocado (user desactivado)'
          : 'Firebase ID token verification failed',
      );
      return c.json({ error: isRevoked ? 'Token revoked' : 'Invalid token' }, 401);
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
