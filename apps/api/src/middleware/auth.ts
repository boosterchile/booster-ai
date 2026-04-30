import type { Logger } from '@booster-ai/logger';
import { OAuth2Client } from 'google-auth-library';
import type { MiddlewareHandler } from 'hono';

/**
 * Middleware de autenticación Cloud Run SA-to-SA vía OIDC identity token.
 *
 * Cuando el apps/whatsapp-bot llama a apps/api, obtiene un identity token
 * firmado por Google con el email de su SA como `email` claim, y lo manda
 * en `Authorization: Bearer <jwt>`.
 *
 * Verificación:
 * 1. Firma criptográfica contra Google JWKS (vía OAuth2Client.verifyIdToken
 *    de `google-auth-library` — caché de keys + verificación RS256/ES256).
 * 2. `aud` ∈ apiAudience (lista de URLs aceptadas — soporta interno *.run.app
 *    y público api.boosterchile.com como diseño permanente).
 * 3. `email` == allowedCallerSa (whitelist de un único SA caller en thin slice).
 * 4. `exp` > now (verifyIdToken ya lo valida; chequeo redundante por defensa
 *    en profundidad).
 *
 * Cierra la deuda activa #AUTH-HARDEN-001: la versión previa decodificaba el
 * JWT sin verificar firma — la única defensa real era Cloud Run RBAC + LB
 * filtrando origen. Si esos eslabones fallaran, cualquiera podía falsificar
 * tokens. Ahora la firma es obligatoria.
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
  /**
   * Email del SA único que está autorizado a invocar endpoints protegidos.
   * En el thin slice: el SA del whatsapp-bot. Slice 2: lista de SAs por rol.
   */
  allowedCallerSa: string;
  logger: Logger;
  /**
   * OAuth2Client inyectable para tests (permite stubbear verifyIdToken sin
   * pegarle a la red). En producción se crea una sola instancia compartida
   * en server.ts.
   */
  oauthClient?: OAuth2Client;
}): MiddlewareHandler {
  const oauthClient = opts.oauthClient ?? new OAuth2Client();
  const apiAudienceMutable = [...opts.apiAudience]; // verifyIdToken espera array mutable

  return async (c, next) => {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      opts.logger.warn({ path: c.req.path }, 'Missing Bearer token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.slice('Bearer '.length).trim();

    let payload: ReturnType<Awaited<ReturnType<OAuth2Client['verifyIdToken']>>['getPayload']>;
    try {
      // verifyIdToken hace todo el heavy lifting:
      //   - parsea JWT, valida estructura
      //   - obtiene Google JWKS (cacheadas por el cliente)
      //   - verifica firma RS256/ES256
      //   - valida iss = accounts.google.com (o https://...)
      //   - valida exp > now
      //   - valida aud ∈ apiAudienceMutable
      const ticket = await oauthClient.verifyIdToken({
        idToken: token,
        audience: apiAudienceMutable,
      });
      payload = ticket.getPayload();
    } catch (err) {
      opts.logger.warn(
        { err: err instanceof Error ? err.message : String(err), path: c.req.path },
        'JWT verification failed',
      );
      return c.json({ error: 'Invalid token' }, 401);
    }

    if (!payload) {
      opts.logger.warn({ path: c.req.path }, 'JWT payload empty after verification');
      return c.json({ error: 'Invalid token' }, 401);
    }

    // Defense in depth: verifyIdToken ya validó exp, pero re-chequeamos por
    // si la implementación cambia o el `clockSkew` interno permitiera margen.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < nowSeconds) {
      return c.json({ error: 'Token expired' }, 401);
    }

    // Whitelist explícita del caller SA. Aunque la firma sea válida y el aud
    // esté en la lista, si el `email` claim no es nuestro caller permitido,
    // se rechaza. Esto protege contra cualquier SA de Google que pueda
    // generar tokens válidamente firmados pero no autorizados.
    if (payload.email !== opts.allowedCallerSa) {
      opts.logger.warn(
        { email: payload.email, expected: opts.allowedCallerSa, path: c.req.path },
        'Caller SA not allowed',
      );
      return c.json({ error: 'Caller not allowed' }, 403);
    }

    // Propagar identity al contexto — útil para logs en handlers.
    c.set('callerSa', payload.email);

    await next();
    return;
  };
}
