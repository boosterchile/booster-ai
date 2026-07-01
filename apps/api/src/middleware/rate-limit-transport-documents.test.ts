import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  KEY_PREFIX,
  createRateLimitTransportDocumentsMiddleware,
} from './rate-limit-transport-documents.js';

// Review F4-4a finding 5 — middleware rate-limit de las ESCRITURAS del
// repositorio documental de transporte: cap per-user (uid, default 20 / 60s)
// con fallback a IP. 21º POST → 429. GET no consume cuota. Redis down → 503
// fail-closed con Retry-After:30 (paridad rate-limit-signup SC-1.2.5).

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

/**
 * App con un middleware que simula firebaseAuth seteando `firebaseClaims.uid`
 * (cuando `uid` se pasa), seguido del middleware bajo test y handlers POST/GET.
 */
function makeApp(
  middleware: ReturnType<typeof createRateLimitTransportDocumentsMiddleware>,
  uid?: string,
) {
  const app = new Hono();
  app.use('/transport-orders/*', async (c, next) => {
    if (uid) {
      c.set('firebaseClaims', {
        uid,
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.use('/transport-orders/*', middleware);
  app.post('/transport-orders/:id/documents', (c) => c.json({ ok: true }, 202));
  app.get('/transport-orders/:id/documents', (c) => c.json({ documents: [] }));
  return app;
}

function post(app: Hono, xff?: string) {
  return app.request('/transport-orders/trip-1/documents', {
    method: 'POST',
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
}

function getReq(app: Hono, xff?: string) {
  return app.request('/transport-orders/trip-1/documents', {
    method: 'GET',
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
}

describe('rate-limit-transport-documents middleware (F4-4a finding 5)', () => {
  it('happy path: 1 POST con uid → 202 + counter scope=user incrementado', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware, 'uid-abc');

    const res = await post(app, '1.2.3.4');
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}uid-abc`]);
    expect(calls.expireCalled[0]?.[1]).toBe(60);
    expect(calls.expireCalled[0]?.[2]).toBe('NX');
  });

  it('GET no consume cuota: passthrough sin tocar Redis', async () => {
    const { redis, calls } = makeRedis([]);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware, 'uid-abc');

    const res = await getReq(app, '1.2.3.4');
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([]);
  });

  it('20 POSTs passthrough, 21º → 429 con Retry-After:60 + X-RateLimit-Scope:user', async () => {
    const counters = Array.from({ length: 21 }, (_, i) => i + 1); // 1..21
    const { redis } = makeRedis(counters);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware, 'uid-abc');

    for (let i = 0; i < 20; i++) {
      expect((await post(app, '9.9.9.9')).status).toBe(202);
    }
    const over = await post(app, '9.9.9.9');
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe('60');
    expect(over.headers.get('X-RateLimit-Scope')).toBe('user');
    const json = (await over.json()) as { error: string; code: string };
    expect(json.error).toBe('too_many_attempts');
    expect(json.code).toBe('too_many_attempts');
  });

  it('mismo uid desde IPs distintas comparte counter → 429 igual (cap por cuenta)', async () => {
    const counters = Array.from({ length: 21 }, (_, i) => i + 1);
    const { redis, calls } = makeRedis(counters);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware, 'uid-rotador');

    for (let i = 0; i < 20; i++) {
      expect((await post(app, `10.0.0.${i}`)).status).toBe(202);
    }
    const over = await post(app, '10.0.0.99');
    expect(over.status).toBe(429);
    // Todas las keys son del mismo uid sin importar la IP.
    expect(calls.incrCalled.every((k) => k === `${KEY_PREFIX}uid-rotador`)).toBe(true);
  });

  it('fallback a IP cuando no hay uid: scope=ip', async () => {
    const { redis, calls } = makeRedis([1]);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware); // sin uid

    const res = await post(app, '5.5.5.5');
    expect(res.status).toBe(202);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}5.5.5.5`]);
  });

  it('Redis pipeline throw → 503 fail-closed con Retry-After:30', async () => {
    const { redis } = makeRedis({ throwOnExec: new Error('ECONNREFUSED') });
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const app = makeApp(middleware, 'uid-abc');

    const res = await post(app, '1.2.3.4');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const json = (await res.json()) as { error: string; code: string };
    expect(json.error).toBe('service_unavailable');
    expect(json.code).toBe('service_unavailable');
  });

  it('uids distintos tienen counters independientes', async () => {
    const { redis } = makeRedis([1, 1, 2, 2]);
    const middlewareA = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
    });
    const appA = makeApp(middlewareA, 'uid-1');
    const appB = makeApp(middlewareA, 'uid-2');

    for (let i = 0; i < 2; i++) {
      expect((await post(appA, '1.1.1.1')).status).toBe(202);
      expect((await post(appB, '1.1.1.1')).status).toBe(202);
    }
  });

  it('límite configurable: limit=2 → 3º POST es 429', async () => {
    const { redis } = makeRedis([1, 2, 3]);
    const middleware = createRateLimitTransportDocumentsMiddleware({
      redis: redis as never,
      logger: noopLogger,
      limit: 2,
    });
    const app = makeApp(middleware, 'uid-abc');

    expect((await post(app, '4.4.4.4')).status).toBe(202);
    expect((await post(app, '4.4.4.4')).status).toBe(202);
    expect((await post(app, '4.4.4.4')).status).toBe(429);
  });
});
