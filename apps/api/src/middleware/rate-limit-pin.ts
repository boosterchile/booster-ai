import type { Logger } from '@booster-ai/logger';
import { rutSchema } from '@booster-ai/shared-schemas';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';

/**
 * T9 + T10 SEC-001 (sec-001-cierre §3 H2 SC-H2.1, SC-H2.1b, SC-H2.1c,
 * SC-H2.2, SC-H2.4) — middleware Hono que rate-limita
 * `POST /auth/driver-activate` con dos counters Redis independientes:
 *
 *   - Per-RUT (T9): `rl:pin-activate:<rutCanonical>` — 5 intentos /
 *     15min por RUT normalizado. Si counter > limit → 429 con
 *     `X-RateLimit-Scope: rut`.
 *   - Per-IP (T10 SC-H2.4): `rl:pin-activate:ip:<ip>` — 30 intentos /
 *     15min por IP origen. Contra attackers que rotan RUTs. Si supera
 *     → 429 con `X-RateLimit-Scope: ip`.
 *
 * Ambos counters se incrementan en el MISMO pipeline atómico (1 RTT
 * a Redis). El response prioritiza el scope IP si ambos exceden, per
 * spec: "attacker rota 20 RUTs distintos → IP-based fires a los 30
 * intentos".
 *
 * T10 SC-H2.1b — fail-closed loudly: si el pipeline falla (Redis
 * unreachable, timeout, etc.), el middleware retorna
 * `503 service_unavailable` + header `Retry-After: 30`. **No silent
 * fail-open**: rate-limit es defensa de seguridad, no degradable.
 * El logger.error captura el err para post-mortem.
 *
 * Trust boundary X-Forwarded-For: en prod Cloud Run el LB (ADR-009)
 * setea el header con el client IP. Sin un proxy delante (dev local
 * sin LB), el header puede ser ausente o spoofeable; en ese caso
 * caemos a la string `unknown` que comparte bucket — aceptable en
 * dev. En prod la cascada Cloud Armor (1000/min/IP por defecto)
 * actúa como pre-filtro antes que llegue al middleware (ver
 * docs/qa/rate-limit-cascade.md).
 *
 * Body parsing: el middleware lee `c.req.json()` que Hono memoiza —
 * zValidator del handler vuelve a leer el body sin re-parsear. Si el
 * body NO es JSON parseable o no contiene `rut`, el middleware skipea
 * (no incrementa counter; el handler vía zValidator retornará 400).
 * Esto evita un oracle de RUTs válidos a través del comportamiento
 * del counter.
 */

export const KEY_PREFIX = 'rl:pin-activate:';
export const IP_KEY_PREFIX = 'rl:pin-activate:ip:';
const DEFAULT_LIMIT_PER_RUT = 5;
const DEFAULT_LIMIT_PER_IP = 30;
const DEFAULT_WINDOW_SECONDS = 900;
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;

export interface RateLimitPinOptions {
  redis: Redis;
  logger: Logger;
  limitPerRut?: number;
  limitPerIp?: number;
  windowSeconds?: number;
}

export function createRateLimitPinMiddleware(opts: RateLimitPinOptions): MiddlewareHandler {
  const rutLimit = opts.limitPerRut ?? DEFAULT_LIMIT_PER_RUT;
  const ipLimit = opts.limitPerIp ?? DEFAULT_LIMIT_PER_IP;
  const window = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimitPin(c, next) {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      // Body no parseable — skip. El zValidator del handler manejará el 400.
      return next();
    }

    const rawRut = isObject(body) && typeof body.rut === 'string' ? body.rut : null;
    if (!rawRut) {
      return next();
    }

    // Mismo validador que el handler (auth-driver.ts:69) — rutSchema
    // normaliza al canónico `12345678-5` y rechaza inputs que el
    // handler también rechazaría. Counter sólo registra intentos que
    // el handler hubiera procesado (sin polución por inputs basura).
    const parsed = rutSchema.safeParse(rawRut);
    if (!parsed.success) {
      return next();
    }
    const normRut = parsed.data;

    const rutKey = `${KEY_PREFIX}${normRut}`;
    const ip = extractClientIp(c.req.header('x-forwarded-for'));
    const ipKey = `${IP_KEY_PREFIX}${ip}`;

    let rutCount: number;
    let ipCount: number;
    try {
      const results = await opts.redis
        .multi()
        .incr(rutKey)
        .expire(rutKey, window, 'NX')
        .incr(ipKey)
        .expire(ipKey, window, 'NX')
        .exec();
      rutCount = Number(results?.[0]?.[1] ?? 0);
      ipCount = Number(results?.[2]?.[1] ?? 0);
    } catch (err) {
      // T10 SC-H2.1b — fail-closed loudly. No silent fail-open: rate-limit
      // es defensa de seguridad, debe estar UP o el endpoint se bloquea.
      opts.logger.error(
        { err, rutNormalizado: normRut, ip },
        'rate-limit-pin: Redis pipeline failed; fail-closed con 503',
      );
      c.header('Retry-After', String(FAIL_CLOSED_RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }

    // Orden de chequeo: IP primero (prioridad spec — "attacker rota RUTs
    // → IP-based fires"). Si IP excede, devolvemos 429 con scope=ip aún
    // si RUT también excede.
    if (ipCount > ipLimit) {
      opts.logger.warn(
        { ip, ipCount, ipLimit, windowSeconds: window },
        'rate-limit-pin: 429 too_many_attempts scope=ip',
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', 'ip');
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    if (rutCount > rutLimit) {
      opts.logger.warn(
        { rutNormalizado: normRut, rutCount, rutLimit, windowSeconds: window },
        'rate-limit-pin: 429 too_many_attempts scope=rut',
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', 'rut');
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Extrae el primer IP del header `X-Forwarded-For` (el LB en prod
 * pone el client IP como primero, separado por comas si hubo más
 * hops). Si el header está ausente, devolvemos `'unknown'` que
 * comparte bucket — aceptable en dev local sin LB; en prod Cloud
 * Armor filtra antes de que llegue al middleware (ver
 * docs/qa/rate-limit-cascade.md §Trust boundary).
 */
function extractClientIp(xff: string | undefined): string {
  if (!xff) {
    return 'unknown';
  }
  const first = xff.split(',')[0]?.trim();
  return first && first.length > 0 ? first : 'unknown';
}
