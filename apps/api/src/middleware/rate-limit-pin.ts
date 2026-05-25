import type { Logger } from '@booster-ai/logger';
import { rutSchema } from '@booster-ai/shared-schemas';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';

/**
 * T9 SEC-001 (sec-001-cierre §3 H2 SC-H2.1, SC-H2.1c, SC-H2.2) —
 * middleware Hono que rate-limita `POST /auth/driver-activate` por RUT
 * normalizado.
 *
 * Política base (T9):
 *   - Límite: 5 intentos por RUT en 15 min (configurable).
 *   - Counter en Memorystore Redis HA (T1 verificado STANDARD_HA).
 *   - Key: `rl:pin-activate:<rutNormalizado>` para colapsar formatos
 *     equivalentes ("12.345.678-5" y "123456785" → mismo bucket).
 *   - Window fija (no sliding): `EXPIRE NX` setea TTL solo en el primer
 *     INCR, así sucesivos intentos no refrescan el TTL. Predecible y
 *     auditable.
 *   - Si el counter > limit: 429 `too_many_attempts` + header
 *     `Retry-After: 900`.
 *
 * Fuera de scope T9 (a cubrir en T10):
 *   - IP-based global limit (30/15min/IP) — SC-H2.4.
 *   - Fail-closed loudly si Redis down (503 service_unavailable) —
 *     SC-H2.1b. T9 deja que el error Redis propague como 500 default.
 *   - Cloud Armor cascade docs — SC-1.2.5.
 *
 * Body parsing: el middleware lee `c.req.json()` que Hono memoiza —
 * zValidator del handler vuelve a leer el body sin re-parsear ni
 * consumirlo dos veces. Si el body NO es JSON parseable o no contiene
 * `rut`, el middleware skipea (no incrementa counter; el handler vía
 * zValidator retornará 400). Esto evita un oracle de RUTs válidos a
 * través del comportamiento del counter.
 */

export const KEY_PREFIX = 'rl:pin-activate:';
const DEFAULT_LIMIT_PER_RUT = 5;
const DEFAULT_WINDOW_SECONDS = 900;

export interface RateLimitPinOptions {
  redis: Redis;
  logger: Logger;
  limitPerRut?: number;
  windowSeconds?: number;
}

export function createRateLimitPinMiddleware(opts: RateLimitPinOptions): MiddlewareHandler {
  const limit = opts.limitPerRut ?? DEFAULT_LIMIT_PER_RUT;
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

    const key = `${KEY_PREFIX}${normRut}`;

    const results = await opts.redis.multi().incr(key).expire(key, window, 'NX').exec();
    const incrResult = results?.[0];
    const count = Number(incrResult?.[1] ?? 0);

    if (count > limit) {
      opts.logger.warn(
        { rutNormalizado: normRut, count, limit, windowSeconds: window },
        'rate-limit-pin: 429 too_many_attempts',
      );
      c.header('Retry-After', String(window));
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
