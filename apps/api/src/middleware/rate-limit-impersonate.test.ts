import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { KEY_PREFIX, createRateLimitImpersonateMiddleware } from './rate-limit-impersonate.js';

/**
 * Rate-limit del endpoint POST /auth/impersonate (impersonación auditada) —
 * "rate-limit activo" del trust boundary. Cap per-admin-uid (default 10/60s),
 * fail-closed 503 si Redis cae (paridad rate-limit-transport-documents).
 */

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

interface MakeRedisOptions {
  counters?: number[];
  throwOnExec?: Error;
}

function makeRedis(opts: MakeRedisOptions): { redis: unknown; incrCalled: string[] } {
  const counters = opts.counters ?? [];
  const incrCalled: string[] = [];
  let i = 0;
  const pipeline = {
    incr(key: string) {
      incrCalled.push(key);
      return this;
    },
    expire() {
      return this;
    },
    async exec(): Promise<unknown[]> {
      if (opts.throwOnExec) {
        throw opts.throwOnExec;
      }
      const c = counters[i] ?? 0;
      i += 1;
      return [[null, c]];
    },
  };
  return { redis: { multi: () => pipeline }, incrCalled };
}

function makeApp(
  middleware: ReturnType<typeof createRateLimitImpersonateMiddleware>,
  uid?: string,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (uid) {
      c.set('firebaseClaims', { uid } as never);
    }
    await next();
  });
  app.use('*', middleware);
  app.post('/auth/impersonate', (c) => c.json({ ok: true }));
  return app;
}

function post(app: Hono) {
  return app.request('/auth/impersonate', { method: 'POST' });
}

describe('rate-limit-impersonate middleware', () => {
  it('bajo el límite → passthrough 200, key per-admin-uid', async () => {
    const { redis, incrCalled } = makeRedis({ counters: [1] });
    const app = makeApp(
      createRateLimitImpersonateMiddleware({ redis: redis as never, logger: noopLogger }),
      'admin-uid',
    );
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(incrCalled[0]).toBe(`${KEY_PREFIX}admin-uid`);
  });

  it('sobre el límite → 429 too_many_attempts + Retry-After', async () => {
    const { redis } = makeRedis({ counters: [11] });
    const app = makeApp(
      createRateLimitImpersonateMiddleware({
        redis: redis as never,
        logger: noopLogger,
        limit: 10,
      }),
      'admin-uid',
    );
    const res = await post(app);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('too_many_attempts');
  });

  it('Redis cae → 503 service_unavailable fail-closed (no fail-open)', async () => {
    const { redis } = makeRedis({ throwOnExec: new Error('redis down') });
    const app = makeApp(
      createRateLimitImpersonateMiddleware({ redis: redis as never, logger: noopLogger }),
      'admin-uid',
    );
    const res = await post(app);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
