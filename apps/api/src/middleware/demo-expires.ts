import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import type { FirebaseClaims } from './firebase-auth.js';

/**
 * T5 SEC-001 Sprint 2a — demo-expires middleware (Hono).
 *
 * Enforce TTL del claim `expires_at` para sessions con `is_demo: true`.
 * Diseño per spec sec-001-cierre §3 H1.1 SC-1.1.2b + SC-1.1.2c + SC-1.1.3:
 *
 *   1. Lee claims desde Hono context `c.get('firebaseClaims')` —
 *      asume firebase-auth middleware ya verificó el token + extrajo
 *      claims. NO re-verifica (evita 2× verifyIdToken cost; spec v4
 *      P0-R3-5).
 *   2. Si claim `is_demo` ausente o falsy → passthrough (zero impacto
 *      cuentas no-demo).
 *   3. Si `is_demo === true`, llama Admin SDK `getUser(uid)` server-side
 *      con cache Redis ≤60s (key `demo-claim:<uid>`). Re-read garantiza
 *      que rotation de claims (PO revocó manualmente) se aplica en
 *      ≤60s sin esperar al token refresh natural de Firebase.
 *   4. Si `expires_at` past → 401 `demo_account_expired`.
 *   5. Fail-closed: Firebase timeout/5xx/network → 503 + `Retry-After:
 *      30` + log `auth.demo.fail_closed.firebase`. Redis unreachable
 *      → 503 + log `auth.demo.fail_closed.redis`.
 *
 * Perf budget (spec SC-1.1.2b + §6.8): ≤5ms p95 cached + ≤200ms p95
 * uncached + 1s timeout absoluto. Excluye firebase-auth shared cost
 * (que ocurre antes de este middleware).
 *
 * Hono Context Variable `firebaseClaims` es seteado por
 * createFirebaseAuthMiddleware (firebase-auth.ts:116).
 */

const CACHE_KEY_PREFIX = 'demo-claim:';
const CACHE_TTL_SECONDS = 60;
const FIREBASE_TIMEOUT_MS = 1_000;
const RETRY_AFTER_SECONDS = 30;

export interface DemoExpiresOptions {
  auth: Auth;
  redis: Redis;
  logger: Logger;
  /** Override perf timeout (default 1000ms). Tests can pass smaller. */
  firebaseTimeoutMs?: number;
}

/**
 * Variant de Firebase `UserRecord` con solo los campos que el middleware
 * lee — minimiza superficie de mock + serialización JSON al cache.
 */
interface CachedUserSnapshot {
  uid: string;
  disabled: boolean;
  customClaims: Record<string, unknown>;
}

function isDemoClaim(claims: FirebaseClaims | undefined): claims is FirebaseClaims {
  if (!claims) {
    return false;
  }
  const custom = claims.custom;
  return Boolean(custom && (custom as Record<string, unknown>).is_demo === true);
}

function isExpired(customClaims: Record<string, unknown>): boolean {
  const raw = customClaims.expires_at;
  if (typeof raw !== 'string' || raw.length === 0) {
    // Claim is_demo:true sin expires_at es estado inválido (debería
    // siempre coexistir post-T4). Tratamos como expired fail-closed.
    return true;
  }
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return true;
  }
  return parsed < Date.now();
}

/**
 * Lookup with cache. Returns snapshot from Redis cache if present,
 * else fetches from Firebase Admin SDK (with timeout race) and writes
 * cache. Throws on Redis unreachable or Firebase timeout/error so the
 * middleware can fail-closed with appropriate metric label.
 */
async function getUserSnapshot(
  uid: string,
  opts: { auth: Auth; redis: Redis; logger: Logger; firebaseTimeoutMs: number },
): Promise<CachedUserSnapshot> {
  const cacheKey = `${CACHE_KEY_PREFIX}${uid}`;

  let cached: string | null;
  try {
    cached = await opts.redis.get(cacheKey);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new RedisUnreachableError(error.message);
  }

  if (cached) {
    try {
      return JSON.parse(cached) as CachedUserSnapshot;
    } catch {
      // Cache corrupto: continuar al lookup live (no fatal).
      opts.logger.warn({ uid }, 'demo-expires: cache JSON corrupto, refrescando');
    }
  }

  // Live fetch con timeout race — Firebase Admin SDK no expone
  // AbortController nativo, así que carrera vs setTimeout. El SDK puede
  // seguir corriendo en background tras el timeout (acceptable: el
  // siguiente request hace su propio race; el SDK eventualmente resuelve
  // sin side-effects observables porque ignoramos la promise).
  let user: Awaited<ReturnType<typeof opts.auth.getUser>>;
  try {
    user = await Promise.race([
      opts.auth.getUser(uid),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new FirebaseTimeoutError()), opts.firebaseTimeoutMs),
      ),
    ]);
  } catch (err) {
    if (err instanceof FirebaseTimeoutError) {
      throw err;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    throw new FirebaseFetchError(error.message);
  }

  const snapshot: CachedUserSnapshot = {
    uid: user.uid,
    disabled: Boolean(user.disabled),
    customClaims: (user.customClaims ?? {}) as Record<string, unknown>,
  };

  // Cache write best-effort: si Redis falla acá, no fail al caller
  // (el snapshot ya está). Loguear warn.
  try {
    await opts.redis.set(cacheKey, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    opts.logger.warn({ uid, err }, 'demo-expires: failed to write cache (non-fatal)');
  }

  return snapshot;
}

class RedisUnreachableError extends Error {
  override readonly name = 'RedisUnreachableError';
}
class FirebaseTimeoutError extends Error {
  override readonly name = 'FirebaseTimeoutError';
}
class FirebaseFetchError extends Error {
  override readonly name = 'FirebaseFetchError';
}

export function createDemoExpiresMiddleware(opts: DemoExpiresOptions): MiddlewareHandler {
  const firebaseTimeoutMs = opts.firebaseTimeoutMs ?? FIREBASE_TIMEOUT_MS;

  return async function demoExpires(c, next) {
    const claims = c.get('firebaseClaims') as FirebaseClaims | undefined;

    // Path 1: sin claim is_demo:true → passthrough zero-cost para
    // cuentas no-demo. Mayor parte del tráfico cae acá.
    if (!isDemoClaim(claims)) {
      await next();
      return;
    }

    // Path 2: claim is_demo:true → fetch snapshot fresh + check expires.
    let snapshot: CachedUserSnapshot;
    try {
      snapshot = await getUserSnapshot(claims.uid, {
        auth: opts.auth,
        redis: opts.redis,
        logger: opts.logger,
        firebaseTimeoutMs,
      });
    } catch (err) {
      if (err instanceof RedisUnreachableError) {
        opts.logger.error({ uid: claims.uid, err: err.message }, 'auth.demo.fail_closed.redis');
        c.header('Retry-After', String(RETRY_AFTER_SECONDS));
        return c.json(
          { error: 'service_unavailable', reason: 'demo session check temporarily unavailable' },
          503,
        );
      }
      if (err instanceof FirebaseTimeoutError || err instanceof FirebaseFetchError) {
        opts.logger.error(
          {
            uid: claims.uid,
            err: err.message,
            kind: err.name,
          },
          'auth.demo.fail_closed.firebase',
        );
        c.header('Retry-After', String(RETRY_AFTER_SECONDS));
        return c.json(
          { error: 'service_unavailable', reason: 'demo session check temporarily unavailable' },
          503,
        );
      }
      // Unknown error path — fail-closed igual.
      opts.logger.error({ uid: claims.uid, err }, 'auth.demo.fail_closed.unknown');
      c.header('Retry-After', String(RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable' }, 503);
    }

    // Path 3: snapshot recibido. Si disabled o expires_at past → 401.
    if (snapshot.disabled) {
      opts.logger.info(
        { uid: claims.uid },
        'demo-expires: account disabled (retired) — 401 demo_account_expired',
      );
      return c.json({ error: 'demo_account_expired', reason: 'account_disabled' }, 401);
    }

    if (isExpired(snapshot.customClaims)) {
      opts.logger.info(
        {
          uid: claims.uid,
          expires_at: snapshot.customClaims.expires_at,
        },
        'demo-expires: claim expired — 401 demo_account_expired',
      );
      return c.json({ error: 'demo_account_expired', reason: 'expires_at_past' }, 401);
    }

    await next();
    return;
  };
}

/** Re-export error classes for tests/observability. */
export const _internalErrors = {
  RedisUnreachableError,
  FirebaseTimeoutError,
  FirebaseFetchError,
};
