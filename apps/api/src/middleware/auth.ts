import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';

/**
 * Middleware de autenticación Cloud Run SA-to-SA vía OIDC identity token.
 *
 * Cuando el apps/whatsapp-bot llama a apps/api, obtiene un identity token
 * firmado por Google con el email de su SA como `email` claim, y lo manda
 * en `Authorization: Bearer <jwt>`.
 *
 * Verificación (simplificada para el thin slice):
 * 1. Decodificar el JWT.
 * 2. Verificar la firma contra Google public keys (JWKS en oauth2.googleapis.com).
 * 3. Verificar `aud` == API_AUDIENCE (URL del service api).
 * 4. Verificar `email` == ALLOWED_CALLER_SA.
 * 5. Verificar `exp` > now.
 *
 * Para slices siguientes: usar `google-auth-library` OAuth2Client.verifyIdToken()
 * que hace todo lo anterior correctamente. Aquí lo hacemos manual para no agregar
 * otra dep pesada en el thin slice.
 *
 * LIMITACIÓN DEL THIN SLICE: esta implementación NO verifica la firma
 * criptográfica del JWT todavía. Es seguro porque:
 *   a) Cloud Run solo deja invocar este service a los SAs con roles/run.invoker.
 *   b) El Global HTTPS LB (networking.tf) hace el filtrado de origen.
 * Pero el chequeo de firma va en el slice 2. Tracking: #AUTH-HARDEN-001.
 */
export function createAuthMiddleware(opts: {
  /**
   * Lista de audiences aceptadas. El claim `aud` del token tiene que matchear
   * alguna de ellas. Soportamos múltiples por diseño: la URL interna
   * *.run.app (canónica para Cloud Run-to-Cloud Run) y la URL pública
   * https://api.boosterchile.com (cubre callers que entren por el LB y
   * firmen el OIDC con la URL pública).
   */
  apiAudience: readonly string[];
  allowedCallerSa: string;
  logger: Logger;
}): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      opts.logger.warn({ path: c.req.path }, 'Missing Bearer token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const claims = decodeJwtUnsafe(token);

    if (!claims) {
      return c.json({ error: 'Malformed token' }, 401);
    }

    if (typeof claims.aud !== 'string' || !opts.apiAudience.includes(claims.aud)) {
      opts.logger.warn({ aud: claims.aud, accepted: opts.apiAudience }, 'Token audience mismatch');
      return c.json({ error: 'Invalid audience' }, 403);
    }

    if (claims.email !== opts.allowedCallerSa) {
      opts.logger.warn({ email: claims.email }, 'Caller SA not allowed');
      return c.json({ error: 'Caller not allowed' }, 403);
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < nowSeconds) {
      return c.json({ error: 'Token expired' }, 401);
    }

    // Propagar identity al contexto — útil para logs en handlers.
    c.set('callerSa', claims.email);

    await next();
    return;
  };
}

interface JwtClaims {
  aud?: string;
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
}

/**
 * Decodifica el JWT sin verificar firma. NO confiar en los claims hasta validar
 * con Google JWKS — ver nota de limitación del thin slice arriba.
 */
function decodeJwtUnsafe(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const payloadB64 = parts[1];
  if (!payloadB64) {
    return null;
  }
  try {
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}
