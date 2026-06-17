import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import { extractClientIp } from './client-ip.js';

/**
 * P1-4 (audit 2026-06-14) — middleware Hono que rate-limita el endpoint
 * público de tracking `GET /public/tracking/:token` per-IP.
 *
 * El endpoint NO requiere auth: la 1ª defensa es la opacidad del token (UUID,
 * 122 bits) + redacción del payload (sin plate completa / driver / precio /
 * telemetría >30min). Sin un cap, un atacante puede:
 *   - enumerar tokens (mayoría 404) buscando links válidos;
 *   - martillar un link conocido para agotar recursos (cada hit hace lookup
 *     DB + posible call a Routes API).
 *
 * Counter Redis: `rl:public-tracking:<ip>` — default 60 req / 60s por IP.
 * 61º → 429 con `Retry-After: 60` + `X-RateLimit-Scope: ip`.
 *
 * **Scope solo-IP** (paridad con rate-limit-signup): la IP es la única señal
 * estable pre-auth. El cap per-IP cubre la amenaza declarada (enumeración /
 * agotamiento desde un origen) sin crear una key Redis por token probado
 * (un counter per-token incrementaría una key distinta por cada token
 * inexistente → amplificación de memoria bajo enumeración). La protección
 * contra un flood DISTRIBUIDO de un mismo token (muchas IPs) es trabajo de la
 * cascada Cloud Armor (1000/min/IP global, docs/qa/rate-limit-cascade.md),
 * no de este middleware.
 *
 * **Fail-closed loudly** (paridad rate-limit-pin/signup SC-1.2.5): si el
 * pipeline Redis falla, retorna `503 service_unavailable` + `Retry-After: 30`.
 * Rate-limit es defensa de seguridad — no degradar a fail-open. Durante una
 * caída de Redis el resto de la app (login/signup/SSE) ya está degradado, así
 * que el tracking público fallando-cerrado es consistente con ese estado.
 *
 * Trust boundary X-Forwarded-For: misma fuente única (`extractClientIp`) que
 * pin/signup — bajo GCLB la IP confiable es la penúltima entry (la primera la
 * controla el cliente). Header ausente (dev sin LB) → bucket `unknown`.
 */

export const KEY_PREFIX = 'rl:public-tracking:';
const DEFAULT_LIMIT_PER_IP = 60;
const DEFAULT_WINDOW_SECONDS = 60;
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;

export interface RateLimitPublicTrackingOptions {
  redis: Redis;
  logger: Logger;
  limitPerIp?: number;
  windowSeconds?: number;
}

export function createRateLimitPublicTrackingMiddleware(
  opts: RateLimitPublicTrackingOptions,
): MiddlewareHandler {
  const ipLimit = opts.limitPerIp ?? DEFAULT_LIMIT_PER_IP;
  const window = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimitPublicTracking(c, next) {
    const ip = extractClientIp(c.req.header('x-forwarded-for'));
    const ipKey = `${KEY_PREFIX}${ip}`;

    let ipCount: number;
    try {
      const results = await opts.redis.multi().incr(ipKey).expire(ipKey, window, 'NX').exec();
      ipCount = Number(results?.[0]?.[1] ?? 0);
    } catch (err) {
      // Fail-closed loudly: rate-limit es defensa de seguridad; si Redis cae,
      // bloqueamos el endpoint en lugar de pasar todo.
      opts.logger.error(
        { err, ip },
        'rate-limit-public-tracking: Redis pipeline failed; fail-closed con 503',
      );
      c.header('Retry-After', String(FAIL_CLOSED_RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }

    if (ipCount > ipLimit) {
      opts.logger.warn(
        { ip, ipCount, ipLimit, windowSeconds: window },
        'rate-limit-public-tracking: 429 too_many_attempts scope=ip',
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', 'ip');
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}
