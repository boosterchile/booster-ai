import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type { Db } from '../db/client.js';
import {
  EmpresaNotInMembershipsError,
  UserNotFoundError,
  resolveUserContext,
} from '../services/user-context.js';
import type { FirebaseClaims } from './firebase-auth.js';

/**
 * Middleware que toma las claims de Firebase (seteadas por
 * firebaseAuthMiddleware) y resuelve el contexto del user contra la DB:
 * user row + memberships activas + empresa elegida.
 *
 * El cliente puede mandar header `X-Empresa-Id: <uuid>` para indicar qué
 * empresa quiere usar como activa. Si tiene 1 sola membership, el header
 * es opcional.
 *
 * Comportamiento:
 *   - Sin firebaseClaims previo en context (orden de middlewares mal): 500.
 *   - User no existe en DB: 404 con `code=user_not_registered` para que el
 *     cliente pueda redirigir a onboarding.
 *   - X-Empresa-Id apunta a empresa donde el user no tiene membership: 403.
 *   - Default OK: setea `userContext` en context y pasa a next().
 */
export function createUserContextMiddleware(opts: {
  db: Db;
  logger: Logger;
}): MiddlewareHandler {
  return async (c, next) => {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;
    if (!claims) {
      opts.logger.error(
        { path: c.req.path },
        'userContext middleware ran without firebaseClaims set',
      );
      return c.json({ error: 'internal_server_error' }, 500);
    }

    const requestedEmpresaId = c.req.header('x-empresa-id');

    try {
      const ctx = await resolveUserContext({
        db: opts.db,
        firebaseUid: claims.uid,
        requestedEmpresaId,
      });
      c.set('userContext', ctx);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        opts.logger.info(
          { firebaseUid: claims.uid, path: c.req.path },
          'User not registered yet; client should redirect to onboarding',
        );
        return c.json({ error: 'user_not_registered', code: 'user_not_registered' }, 404);
      }
      if (err instanceof EmpresaNotInMembershipsError) {
        opts.logger.warn(
          {
            userId: err.userId,
            requestedEmpresaId: err.requestedEmpresaId,
            path: c.req.path,
          },
          'X-Empresa-Id does not match any active membership',
        );
        return c.json({ error: 'empresa_forbidden', code: 'empresa_forbidden' }, 403);
      }
      throw err;
    }

    await next();
    return;
  };
}
