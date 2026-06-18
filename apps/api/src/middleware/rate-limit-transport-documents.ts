import type { Logger } from '@booster-ai/logger';
import type { MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import { extractClientIp } from './client-ip.js';

/**
 * Review F4-4a finding 5 — middleware Hono que rate-limita las ESCRITURAS del
 * repositorio documental de transporte (`POST /transport-orders/:id/documents`
 * y `POST /documents/:id/manual-entry`).
 *
 * A diferencia de rate-limit-signup/public-tracking (pre-auth, scope solo-IP),
 * estas rutas SÍ están autenticadas: el chain firebaseAuth corre ANTES de este
 * middleware, así que tenemos `firebaseClaims.uid` como señal de identidad
 * estable. Scope primario = uid del usuario; fallback a IP si el uid no está
 * (no debería pasar tras firebaseAuth, pero fail-safe). Esto acota el abuso por
 * cuenta (subir cientos de archivos a GCS) que un cap solo-IP no atrapa si el
 * atacante rota IPs con un mismo token.
 *
 * Counter Redis: `rl:transport-docs:<uid|ip-fallback>` — default 20 escrituras
 * / 60s. El 21º → 429 con `Retry-After: 60` + `X-RateLimit-Scope: user`.
 *
 * Solo cuenta métodos de escritura. Los GET (listado / detalle con signed URL)
 * NO incrementan el counter — son lecturas baratas que no justifican cap aquí
 * (el chain de auth + autorización por tenant ya los protege de abuso masivo).
 *
 * Fail-closed loudly (paridad rate-limit-pin/signup SC-1.2.5): si el pipeline
 * Redis falla, retorna `503 service_unavailable` + `Retry-After: 30`.
 * Rate-limit es defensa de seguridad — no degradar a fail-open.
 *
 * Trust boundary X-Forwarded-For: misma fuente única (`extractClientIp`) que
 * pin/signup/public-tracking — solo relevante en el fallback-IP.
 */

export const KEY_PREFIX = 'rl:transport-docs:';
const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_SECONDS = 60;
const FAIL_CLOSED_RETRY_AFTER_SECONDS = 30;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RateLimitTransportDocumentsOptions {
  redis: Redis;
  logger: Logger;
  limit?: number;
  windowSeconds?: number;
}

export function createRateLimitTransportDocumentsMiddleware(
  opts: RateLimitTransportDocumentsOptions,
): MiddlewareHandler {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const window = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  return async function rateLimitTransportDocuments(c, next) {
    // Solo las escrituras consumen cuota. Las lecturas (GET) pasan directo.
    if (!WRITE_METHODS.has(c.req.method)) {
      return next();
    }

    // Identidad: uid del Firebase ID token (seteado por firebaseAuth, que corre
    // antes en el chain). Fallback a IP si por algún motivo no está presente.
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
      // Fail-closed loudly: rate-limit es defensa de seguridad; si Redis cae,
      // bloqueamos la escritura en lugar de pasar todo.
      opts.logger.error(
        { err, scope, ip: scope === 'ip' ? ip : undefined },
        'rate-limit-transport-documents: Redis pipeline failed; fail-closed con 503',
      );
      c.header('Retry-After', String(FAIL_CLOSED_RETRY_AFTER_SECONDS));
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }

    if (count > limit) {
      opts.logger.warn(
        { scope, count, limit, windowSeconds: window },
        `rate-limit-transport-documents: 429 too_many_attempts scope=${scope}`,
      );
      c.header('Retry-After', String(window));
      c.header('X-RateLimit-Scope', scope);
      return c.json({ error: 'too_many_attempts', code: 'too_many_attempts' }, 429);
    }

    return next();
  };
}
