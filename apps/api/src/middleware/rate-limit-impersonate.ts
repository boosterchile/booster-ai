import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import { extractClientIp } from './client-ip.js';

/**
 * Rate-limit del endpoint `POST /auth/impersonate` (impersonación auditada) —
 * "rate-limit activo" del trust boundary. La impersonación es una acción
 * sensible y de baja frecuencia; capamos por admin (uid del Firebase ID token,
 * seteado por firebaseAuth que corre antes) para que un admin comprometido no
 * pueda mintear tokens de impersonación en masa.
 *
 * Counter Redis: `rl:impersonate:<uid|ip-fallback>` — default 10 emisiones /
 * 60s. La 11ª → 429 con `Retry-After: 60`.
 *
 * Fail-closed loudly (paridad rate-limit-transport-documents / signup): si el
 * pipeline Redis falla → `503 service_unavailable` + `Retry-After: 30`.
 * Rate-limit es defensa de seguridad — no degradar a fail-open.
 */

export const KEY_PREFIX = 'rl:impersonate:';
const DEFAULT_LIMIT = 10;
const DEFAULT_WINDOW_SECONDS = 60;
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;

export interface RateLimitImpersonateOptions {
  redis: Redis;
  logger: Logger;
  limit?: number;
  windowSeconds?: number;
}

export function createRateLimitImpersonateMiddleware(
  opts: RateLimitImpersonateOptions,
): MiddlewareHandler {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const window = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimitImpersonate(c, next) {
    // Identidad: uid del admin (Firebase ID token). Fallback a IP fail-safe.
    const uid = c.get('firebaseClaims')?.uid;
    const ip = extractClientIp(c.req.header('x-forwarded-for'));
    const scope = uid ? 'user' : 'ip';
    const subject = uid ?? ip;
    const key = `${KEY_PREFIX}${subject}`;

    let count: number;
    try {
      const results = await opts.redis.multi().incr(key).expire(key, window, 'NX').exec();
      count = Number(results?.[0]?.[1] ?? 0);
    } catch (err) {
      opts.logger.error(
        { err, scope, ip: scope === 'ip' ? ip : undefined },
        'rate-limit-impersonate: Redis pipeline failed; fail-closed con 503',
      );
      c.header('Retry-After', String(FAIL_CLOSED_RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }

    if (count > limit) {
      opts.logger.warn(
        { scope, count, limit, windowSeconds: window },
        `rate-limit-impersonate: 429 too_many_attempts scope=${scope}`,
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', scope);
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}
