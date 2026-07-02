import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { KEY_PREFIX, createRateLimitSignupMiddleware } from './rate-limit-signup.js';

// T8 SEC-001 Sprint 2b — middleware rate-limit-signup: 5 intentos / 15min por IP.
// 6º → 429. Redis down → 503 fail-closed con Retry-After:30. SC-1.2.5.

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

function makeApp(middleware: ReturnType<typeof createRateLimitSignupMiddleware>) {
  const app = new Hono();
  app.use('/api/v1/signup-request', middleware);
  app.post('/api/v1/signup-request', (c) => c.json({ ok: true }, 202));
  return app;
}

describe('rate-limit-signup middleware (SC-1.2.5)', () => {
  it('happy path: 1 request → passthrough → 202 + counter ip incrementado a 1', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}1.2.3.4`]);
    expect(calls.expireCalled[0]?.[0]).toBe(`${KEY_PREFIX}1.2.3.4`);
    expect(calls.expireCalled[0]?.[1]).toBe(900);
  });

  it('XFF spoofeado (multi-entry) → counter de la IP que vio el LB, no la del atacante', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // El atacante envía '6.6.6.6'; el GCLB appendea su IP real y la
        // del LB. La key debe ser la penúltima (middleware/client-ip).
        'x-forwarded-for': '6.6.6.6, 198.51.100.7, 35.1.1.1',
      },
      body: JSON.stringify({ email: 'a@b.cl', nombreCompleto: 'X' }),
    });
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}198.51.100.7`]);
    expect(calls.incrCalled.some((k) => k.includes('6.6.6.6'))).toBe(false);
  });

  it('5 requests passthrough, 6º → 429 con Retry-After:900 + X-RateLimit-Scope:ip', async () => {
    const { redis } = makeRedis([1, 2, 3, 4, 5, 6]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    for (let i = 0; i < 5; i++) {
      const r = await app.request('/api/v1/signup-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(202);
    }
    const sixth = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9' },
      body: JSON.stringify({}),
    });
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('Retry-After')).toBe('900');
    expect(sixth.headers.get('X-RateLimit-Scope')).toBe('ip');
    const json = (await sixth.json()) as { error: string; code: string };
    expect(json.error).toBe('too_many_attempts');
  });

  it('Redis pipeline throw → 503 fail-closed con Retry-After:30 (SC-1.2.5)', async () => {
    const { redis } = makeRedis({ throwOnExec: new Error('ECONNREFUSED') });
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBe('service_unavailable');
  });

  it('IPs distintas tienen counters independientes (5+5 sin 429)', async () => {
    const { redis } = makeRedis([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    for (let i = 0; i < 5; i++) {
      const a = await app.request('/api/v1/signup-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.1.1.1' },
        body: JSON.stringify({}),
      });
      expect(a.status).toBe(202);
      const b = await app.request('/api/v1/signup-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '2.2.2.2' },
        body: JSON.stringify({}),
      });
      expect(b.status).toBe(202);
    }
  });

  it('Sin X-Forwarded-For: cae a bucket "unknown" (aceptable en dev)', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}unknown`]);
  });

  it('multi-hop X-Forwarded-For: usa la PENÚLTIMA entry (la que vio el LB)', async () => {
    // El contrato anterior ("usa el primer IP") codificaba el bug: bajo
    // GCLB la primera entry es 100% controlada por el cliente
    // (middleware/client-ip.ts, spec fix-xff-trust-boundary).
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitSignupMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware);

    const res = await app.request('/api/v1/signup-request', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '5.5.5.5, 10.0.0.1, 192.168.1.1',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}10.0.0.1`]);
  });
});
