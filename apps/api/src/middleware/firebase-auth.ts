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
/**
 * Resuelve un ticket efímero del SSE → uid. Inyectado desde server.ts
 * (consumeStreamTicket sobre Redis). Devuelve el uid si el ticket es válido,
 * de un solo uso, no expiró y coincide con el assignment del path; null si no.
 */
export type SseTicketStore = (ticket: string, assignmentId: string) => Promise<string | null>;

const STREAM_PATH_RE = /^\/assignments\/([^/]+)\/messages\/stream$/;

export function createFirebaseAuthMiddleware(opts: {
  /**
   * Instancia de firebase-admin Auth. Inyectable para tests (stub
   * verifyIdToken sin pegar a Google).
   */
  auth: Auth;
  logger: Logger;
  /**
   * Store de tickets del SSE (fix-sse-ticket-auth). Si está presente, el
   * GET del stream se autentica con `?ticket=<efímero>` en vez de un Firebase
   * ID token en la URL — que se filtraba a Cloud Trace/Logging. Sin store,
   * el stream no tiene vía de auth por query (devuelve 401).
   */
  sseTicketStore?: SseTicketStore;
}): MiddlewareHandler {
  return async (c, next) => {
    // SSE: EventSource no soporta headers. En vez del Firebase ID token en la
    // URL (se filtraba EN CRUDO a Cloud Trace/Logging — fix-sse-ticket-auth),
    // el GET del stream se autentica con un ticket efímero de un solo uso.
    const streamMatch = STREAM_PATH_RE.exec(c.req.path);
    if (c.req.method === 'GET' && streamMatch && !c.req.header('authorization')) {
      const assignmentId = streamMatch[1] as string;
      const ticket = c.req.query('ticket');
      const uid =
        ticket && opts.sseTicketStore ? await opts.sseTicketStore(ticket, assignmentId) : null;
      if (!uid) {
        opts.logger.warn({ path: c.req.path }, 'SSE ticket inválido/ausente');
        return c.json({ error: 'Unauthorized' }, 401);
      }
      // El ticket prueba la identidad; userContextMiddleware resuelve el user
      // por uid (solo necesita claims.uid). El resto del chain queda intacto.
      c.set('firebaseClaims', {
        uid,
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      } satisfies FirebaseClaims);
      await next();
      return;
    }

    // Path normal: token en header Authorization.
    const authHeader = c.req.header('authorization');
    let token: string | null = null;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim();
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
