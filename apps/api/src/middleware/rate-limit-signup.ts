import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import { extractClientIp } from './client-ip.js';

/**
 * T8 SEC-001 Sprint 2b (sec-001-cierre §3 H1.2 SC-1.2.5) — middleware Hono
 * que rate-limita `POST /api/v1/signup-request` per-IP.
 *
 * Counter Redis: `rl:signup-request:<ip>` — 5 intentos / 15 min por IP.
 * Si counter > limit → 429 con `Retry-After: 900` (window seconds).
 *
 * Scope solo-IP (no per-email): el email NO es trust source (attacker rota
 * emails @gmail.com infinitos a low cost). IP es la única señal estable
 * pre-auth. Cloud Armor cascade (1000/min/IP global) actúa como pre-filtro
 * antes de llegar aquí — ver docs/qa/rate-limit-cascade.md §signup-request
 * layer (entregable T9b).
 *
 * Fail-closed loudly (per SC-1.2.5 + paridad rate-limit-pin SC-H2.1b): si
 * el pipeline Redis falla, retorna `503 service_unavailable` + header
 * `Retry-After: 30`. Rate-limit es defensa de seguridad — no degradar a
 * fail-open.
 *
 * Trust boundary X-Forwarded-For: en prod Cloud Run el LB (ADR-009) setea
 * el header con el client IP. Sin proxy (dev local), header puede ser
 * ausente y caemos a string `unknown` que comparte bucket — aceptable.
 *
 * Body parsing: el middleware NO inspecciona body. Cualquier POST que
 * llegue al path /api/v1/signup-request cuenta como intento — un attacker
 * no puede evadir incrementando con bodies basura porque siempre incrementa.
 */

export const KEY_PREFIX = 'rl:signup-request:';
const DEFAULT_LIMIT_PER_IP = 5;
const DEFAULT_WINDOW_SECONDS = 900;
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;

export interface RateLimitSignupOptions {
  redis: Redis;
  logger: Logger;
  limitPerIp?: number;
  windowSeconds?: number;
}

export function createRateLimitSignupMiddleware(opts: RateLimitSignupOptions): MiddlewareHandler {
  const ipLimit = opts.limitPerIp ?? DEFAULT_LIMIT_PER_IP;
  const window = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimitSignup(c, next) {
    const ip = extractClientIp(c.req.header('x-forwarded-for'));
    const ipKey = `${KEY_PREFIX}${ip}`;

    let ipCount: number;
    try {
      const results = await opts.redis.multi().incr(ipKey).expire(ipKey, window, 'NX').exec();
      ipCount = Number(results?.[0]?.[1] ?? 0);
    } catch (err) {
      // SC-1.2.5 — fail-closed loudly. Rate-limit es defensa de seguridad;
      // si Redis cae, bloqueamos el endpoint en lugar de pasar todo.
      opts.logger.error(
        { err, ip },
        'rate-limit-signup: Redis pipeline failed; fail-closed con 503',
      );
      c.header('Retry-After', String(FAIL_CLOSED_RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }

    if (ipCount > ipLimit) {
      opts.logger.warn(
        { ip, ipCount, ipLimit, windowSeconds: window },
        'rate-limit-signup: 429 too_many_attempts scope=ip',
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', 'ip');
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}
