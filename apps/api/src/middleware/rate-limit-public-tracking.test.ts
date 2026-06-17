import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  KEY_PREFIX,
  createRateLimitPublicTrackingMiddleware,
} from './rate-limit-public-tracking.js';

// P1-4 (audit 2026-06-14) — middleware rate-limit del endpoint público de
// tracking GET /public/tracking/:token: cap per-IP (default 60 / 60s) contra
// enumeración de tokens / agotamiento de recursos. 61º → 429. Redis down →
// 503 fail-closed con Retry-After:30 (paridad rate-limit-signup SC-1.2.5).
// Sin auth: la 1ª defensa es la opacidad del token (122 bits); este es
// defense-in-depth por IP, la única señal estable pre-auth.

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

interface MockPipelineCalls {
  incrCalled: string[];
  expireCalled: Array<[string, number, string]>;
}

interface MakeRedisOptions {
  counters?: number[];
  throwOnExec?: Error;
}

function makeRedis(opts: MakeRedisOptions | number[]): {
  redis: unknown;
  calls: MockPipelineCalls;
} {
  const normalized: MakeRedisOptions = Array.isArray(opts) ? { counters: opts } : opts;
  const counters = normalized.counters ?? [];
  const calls: MockPipelineCalls = { incrCalled: [], expireCalled: [] };
  let i = 0;
  const pipeline = {
    incr(key: string) {
      calls.incrCalled.push(key);
      return this;
    },
    expire(key: string, seconds: number, flag: string) {
      calls.expireCalled.push([key, seconds, flag]);
      return this;
    },
    async exec(): Promise<unknown[]> {
      if (normalized.throwOnExec) {
        throw normalized.throwOnExec;
      }
      const c = counters[i] ?? 0;
      i += 1;
      return [[null, c]];
    },
  };
  const redis = { multi: () => pipeline };
  return { redis, calls };
}

function makeApp(middleware: ReturnType<typeof createRateLimitPublicTrackingMiddleware>) {
  const app = new Hono();
  app.use('/public/tracking/*', middleware);
  app.get('/public/tracking/:token', (c) => c.json({ status: 'ok', token: c.req.param('token') }));
  return app;
}

function get(app: Hono, token: string, xff?: string) {
  return app.request(`/public/tracking/${token}`, {
    method: 'GET',
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
}

describe('rate-limit-public-tracking middleware (P1-4)', () => {
  it('happy path: 1 GET → passthrough → 200 + counter ip incrementado a 1', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await get(app, 'tok-abc', '1.2.3.4');
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}1.2.3.4`]);
    expect(calls.expireCalled[0]?.[0]).toBe(`${KEY_PREFIX}1.2.3.4`);
    expect(calls.expireCalled[0]?.[1]).toBe(60);
    expect(calls.expireCalled[0]?.[2]).toBe('NX');
  });

  it('60 GETs passthrough, 61º → 429 con Retry-After:60 + X-RateLimit-Scope:ip', async () => {
    const counters = Array.from({ length: 61 }, (_, i) => i + 1); // 1..61
    const { redis } = makeRedis(counters);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    for (let i = 0; i < 60; i++) {
      const r = await get(app, 'tok-abc', '9.9.9.9');
      expect(r.status).toBe(200);
    }
    const over = await get(app, 'tok-abc', '9.9.9.9');
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe('60');
    expect(over.headers.get('X-RateLimit-Scope')).toBe('ip');
    const json = (await over.json()) as { error: string; code: string };
    expect(json.error).toBe('too_many_attempts');
    expect(json.code).toBe('too_many_attempts');
  });

  it('enumeración: tokens distintos desde la MISMA IP comparten counter → 429 igual', async () => {
    // El ataque que P1-4 cierra: un atacante iterando tokens (mayoría 404)
    // desde una IP. El cap es per-IP, así que NO se evade variando el token.
    const counters = Array.from({ length: 61 }, (_, i) => i + 1);
    const { redis, calls } = makeRedis(counters);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    for (let i = 0; i < 60; i++) {
      const r = await get(app, `enum-token-${i}`, '7.7.7.7');
      expect(r.status).toBe(200);
    }
    const over = await get(app, 'enum-token-999', '7.7.7.7');
    expect(over.status).toBe(429);
    // Todas las keys son la misma IP, sin importar el token.
    expect(calls.incrCalled.every((k) => k === `${KEY_PREFIX}7.7.7.7`)).toBe(true);
  });

  it('Redis pipeline throw → 503 fail-closed con Retry-After:30 (paridad SC-1.2.5)', async () => {
    const { redis } = makeRedis({ throwOnExec: new Error('ECONNREFUSED') });
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await get(app, 'tok-abc', '1.2.3.4');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBe('service_unavailable');
    expect(json.code).toBe('service_unavailable');
  });

  it('XFF spoofeado (multi-entry) → counter de la IP que vio el LB (penúltima), no la del atacante', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await get(app, 'tok-abc', '6.6.6.6, 198.51.100.7, 35.1.1.1');
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}198.51.100.7`]);
    expect(calls.incrCalled.some((k) => k.includes('6.6.6.6'))).toBe(false);
  });

  it('IPs distintas tienen counters independientes', async () => {
    const { redis } = makeRedis([1, 1, 2, 2]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    for (let i = 0; i < 2; i++) {
      const a = await get(app, 'tok-a', '1.1.1.1');
      expect(a.status).toBe(200);
      const b = await get(app, 'tok-b', '2.2.2.2');
      expect(b.status).toBe(200);
    }
  });

  it('sin X-Forwarded-For → bucket "unknown" (aceptable en dev)', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await get(app, 'tok-abc');
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}unknown`]);
  });

  it('límite configurable: limitPerIp=2 → 3º GET es 429', async () => {
    const { redis } = makeRedis([1, 2, 3]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
      limitPerIp: 2,
    });
    const app = makeApp(middleware);

    expect((await get(app, 't', '4.4.4.4')).status).toBe(200);
    expect((await get(app, 't', '4.4.4.4')).status).toBe(200);
    expect((await get(app, 't', '4.4.4.4')).status).toBe(429);
  });

  it('bucket "unknown" al límite → 429 (fail-safe: bloquea, NO bypass)', async () => {
    // Review seguridad #490 P1-A: las requests sin XFF comparten el bucket
    // `rl:public-tracking:unknown`. Si se supera el límite, se bloquea (no se
    // hace skip): un control de seguridad debe fallar cerrando. En prod el
    // tráfico legítimo nunca cae acá (Cloud Run appendea XFF tras el GCLB).
    const { redis } = makeRedis([1, 2, 3]);
    const middleware = createRateLimitPublicTrackingMiddleware({
      redis: redis as never,
      logger: noopLogger,
      limitPerIp: 2,
    });
    const app = makeApp(middleware);

    expect((await get(app, 't')).status).toBe(200);
    expect((await get(app, 't')).status).toBe(200);
    const over = await get(app, 't');
    expect(over.status).toBe(429);
    expect(over.headers.get('X-RateLimit-Scope')).toBe('ip');
  });
});
