import type { MiddlewareHandler } from 'hono';

/**
 * Path público del verificador de certificados: GET
 * /certificates/:tracking/verify es self-contained y sin auth (la
 * confianza la da la firma KMS + public key publicada), pero comparte
 * mount point con los paths auth-required de /certificates/*.
 */
export const PUBLIC_VERIFY_PATH = /\/certificates\/[^/]+\/verify$/;

/**
 * Envuelve un middleware del chain de /certificates/* con short-circuit
 * para el path público /verify. Hono no permite mezclar middlewares por
 * método/path nativamente; este wrapper es el patrón único de los 3
 * middlewares del chain (firebaseAuth, demoExpires, userContext) — antes
 * eran lambdas duplicadas inline en server.ts.
 */
export function skipPublicVerify(mw: MiddlewareHandler): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'GET' && PUBLIC_VERIFY_PATH.test(c.req.path)) {
      return next();
    }
    return mw(c, next);
  };
}
