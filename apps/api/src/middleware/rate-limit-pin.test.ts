import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_PREFIX, createRateLimitPinMiddleware } from './rate-limit-pin.js';

// T9 SEC-001 — middleware rate-limit-pin: 5 intentos / 15min por RUT
// normalizado. 6º → 429 con header Retry-After:900.
// SC traceability: H2 SC-H2.1 + SC-H2.1c (RUT normalize) + SC-H2.2
// (counter en Redis).

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

function makeRedis(
  // El INCR retorna el counter post-incremento; el test controla qué
  // counter ver. Si pasamos un array, INCR shifts uno por call.
  counters: number[],
): { redis: unknown; calls: MockPipelineCalls } {
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
      const c = counters[i] ?? 0;
      i += 1;
      // ioredis exec retorna array de [err, result] tuples.
      return [
        [null, c],
        [null, 1],
      ];
    },
  };
  const redis = { multi: () => pipeline };
  return { redis, calls };
}

function makeApp(middleware: ReturnType<typeof createRateLimitPinMiddleware>) {
  const app = new Hono();
  app.use('/x', middleware);
  app.post('/x', (c) => c.json({ ok: true }, 200));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createRateLimitPinMiddleware (T9 SEC-001)', () => {
  it('1er intento → next() (counter=1)', async () => {
    const { redis, calls } = makeRedis([1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}12345678-5`]);
    expect(calls.expireCalled).toEqual([[`${KEY_PREFIX}12345678-5`, 900, 'NX']]);
  });

  it('5º intento OK (counter=5 ≤ limit)', async () => {
    const { redis } = makeRedis([5]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
  });

  it('6º intento → 429 + Retry-After:900 (SC-H2.1)', async () => {
    const { redis } = makeRedis([6]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('900');
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: 'too_many_attempts', code: 'too_many_attempts' });
  });

  it('SC-H2.1c — RUT normalize: "12.345.678-5" y "12345678-5" comparten key', async () => {
    // Middleware usa rutSchema.safeParse (mismo validador que el handler
    // en auth-driver.ts:69). Inputs sin guión ("123456785") los rechaza
    // ANTES de incrementar — coherente con el comportamiento del handler
    // que también retorna 401 para ese formato. Aquí verificamos que los
    // dos formatos VÁLIDOS (con-puntos y sin-puntos) colapsan al mismo
    // canónico via la transform del schema.
    const { redis, calls } = makeRedis([1, 2]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12.345.678-5' }),
    });
    await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}12345678-5`, `${KEY_PREFIX}12345678-5`]);
  });

  it('body sin campo rut → skip (no incrementa counter)', async () => {
    const { redis, calls } = makeRedis([1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: '123456' }),
    });
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([]);
  });

  it('body no-JSON → skip (handler downstream maneja el error)', async () => {
    const { redis, calls } = makeRedis([1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    // Skip → llega al handler que retorna 200 (test stub). En prod
    // zValidator retornaría 400 antes del handler.
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([]);
  });

  it('RUT con formato inválido → skip (no oracle de RUTs válidos)', async () => {
    const { redis, calls } = makeRedis([1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: 'not-a-rut' }),
    });
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual([]);
  });
});
