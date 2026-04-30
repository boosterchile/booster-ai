/**
 * Module augmentation para extender el tipo `Variables` de Hono con las
 * keys que setean nuestros middlewares vía `c.set(key, value)` y leen los
 * handlers vía `c.get(key)`.
 *
 * Sin esta extensión, `c.get('firebaseClaims')` falla en TS strict porque
 * el `ContextVariableMap` default está vacío y `c.get` infiere `never`.
 *
 * Cada middleware que setea una key tiene que aparecer aquí. Si agregás
 * uno nuevo, extendé esta interfaz también.
 */
import type { FirebaseClaims } from '../middleware/firebase-auth.js';
import type { UserContext } from '../services/user-context.js';

declare module 'hono' {
  interface ContextVariableMap {
    /**
     * Seteado por createFirebaseAuthMiddleware tras verifyIdToken OK.
     * Optional porque puede no haber corrido el middleware aún (handlers
     * defensivos chequean undefined).
     */
    firebaseClaims?: FirebaseClaims;
    /** Seteado por createUserContextMiddleware tras resolveUserContext OK. */
    userContext?: UserContext;
    /** Seteado por createAuthMiddleware (OIDC SA-to-SA). Email del SA caller. */
    callerSa?: string;
  }
}
