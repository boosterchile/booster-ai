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

interface MakeRedisOptions {
  // Counters por INCR call. T10 extiende a 2 INCR (RUT + IP) por
  // request, así que el orden esperado es [rutCount_req1, ipCount_req1,
  // rutCount_req2, ipCount_req2, ...].
  counters?: number[];
  // Si seteado, la pipeline exec throw en lugar de retornar resultados.
  // Usado para simular Redis unreachable (SC-H2.1b).
  throwOnExec?: Error;
}

function makeRedis(opts: MakeRedisOptions | number[]): {
  redis: unknown;
  calls: MockPipelineCalls;
} {
  // Backwards compat con tests T9 que pasaban un array suelto.
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
      // T10: 2 INCR + 2 EXPIRE → 4 tuples. El middleware lee
      // results[0][1] = rutCount, results[2][1] = ipCount.
      const rutCount = counters[i] ?? 0;
      const ipCount = counters[i + 1] ?? 0;
      i += 2;
      return [
        [null, rutCount],
        [null, 1],
        [null, ipCount],
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
    const { redis, calls } = makeRedis([1, 1]);
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
    // T10: 2 INCR (RUT + IP) por request.
    expect(calls.incrCalled).toEqual([`${KEY_PREFIX}12345678-5`, expect.stringContaining(':ip:')]);
    expect(calls.expireCalled.length).toBe(2);
  });

  it('keyPrefix/ipKeyPrefix custom → counters propios sin tocar los de pin-activate', async () => {
    const { redis, calls } = makeRedis([1, 1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
      keyPrefix: 'rl:login-rut:',
      ipKeyPrefix: 'rl:login-rut:ip:',
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
    expect(calls.incrCalled).toEqual(['rl:login-rut:12345678-5', 'rl:login-rut:ip:1.2.3.4']);
    // Ningún counter con el prefijo del PIN driver.
    expect(calls.incrCalled.some((k) => k.startsWith(KEY_PREFIX))).toBe(false);
  });

  it('XFF spoofeado (múltiples entries) → usa la PENÚLTIMA (la IP que vio el LB)', async () => {
    const { redis, calls } = makeRedis([1, 1]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // El atacante envía '6.6.6.6'; el GCLB appendea su IP real
        // (198.51.100.7) y la del LB (35.1.1.1). La confiable es la penúltima.
        'x-forwarded-for': '6.6.6.6, 198.51.100.7, 35.1.1.1',
      },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
    const ipKeys = calls.incrCalled.filter((k) => k.includes(':ip:'));
    expect(ipKeys).toEqual([`${KEY_PREFIX}ip:198.51.100.7`]);
    // La entry controlada por el atacante NO es la key.
    expect(calls.incrCalled.some((k) => k.includes('6.6.6.6'))).toBe(false);
  });

  it('5º intento OK (counter=5 ≤ limit)', async () => {
    const { redis } = makeRedis([5, 1]);
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

  it('6º intento → 429 + Retry-After:900 + X-RateLimit-Scope:rut (SC-H2.1)', async () => {
    const { redis } = makeRedis([6, 1]);
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
    expect(res.headers.get('X-RateLimit-Scope')).toBe('rut');
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: 'too_many_attempts', code: 'too_many_attempts' });
  });

  it('SC-H2.4 — 31º intento desde misma IP con RUTs distintos → 429 X-RateLimit-Scope:ip', async () => {
    // counter RUT siempre = 1 (RUT distinto cada vez), counter IP escala
    // hasta 31. La response del 31º request debe ser 429 scope=ip.
    const { redis } = makeRedis([1, 31]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('900');
    expect(res.headers.get('X-RateLimit-Scope')).toBe('ip');
  });

  it('SC-H2.1b — Redis unreachable → 503 + Retry-After:30 (fail-closed loudly)', async () => {
    const { redis } = makeRedis({ throwOnExec: new Error('ECONNREFUSED') });
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
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = (await res.json()) as { error: string; code: string };
    expect(body).toEqual({ error: 'service_unavailable', code: 'service_unavailable' });
  });

  it('IP scope > RUT scope cuando ambos exceden (defensa contra rotation primero)', async () => {
    // Si rutCount=6 Y ipCount=31, prioridad va a IP (espec dice "attacker
    // rota RUTs → IP fires"). Esto cubre tanto el caso donde el attacker
    // pega 30 con 6 RUTs distintos como el caso límite donde la misma
    // ronda tropieza ambos.
    const { redis } = makeRedis([6, 31]);
    const mw = createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis
      redis: redis as any,
      logger: noopLogger,
    });
    const app = makeApp(mw);
    const res = await app.request('/x', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Scope')).toBe('ip');
  });

  it('SC-H2.1c — RUT normalize: "12.345.678-5" y "12345678-5" comparten key', async () => {
    // Middleware usa rutSchema.safeParse (mismo validador que el handler
    // en auth-driver.ts:69). Inputs sin guión ("123456785") los rechaza
    // ANTES de incrementar — coherente con el comportamiento del handler
    // que también retorna 401 para ese formato. Aquí verificamos que los
    // dos formatos VÁLIDOS (con-puntos y sin-puntos) colapsan al mismo
    // canónico via la transform del schema.
    const { redis, calls } = makeRedis([1, 1, 2, 2]);
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
    // T10: cada request hace 2 INCR (RUT + IP). Filtramos para chequear
    // que los RUT keys colapsan al mismo canónico.
    const rutKeys = calls.incrCalled.filter((k) => !k.includes(':ip:'));
    expect(rutKeys).toEqual([`${KEY_PREFIX}12345678-5`, `${KEY_PREFIX}12345678-5`]);
  });

  it('body sin campo rut → skip (no incrementa counter)', async () => {
    const { redis, calls } = makeRedis([1, 1]);
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
    const { redis, calls } = makeRedis([1, 1]);
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
    const { redis, calls } = makeRedis([1, 1]);
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

// XFF follow-up parte 2 (.specs/_followups/xff-trust-boundary-resto-endpoints.md):
// reset-on-success del counter per-RUT. Un auth EXITOSO (2xx) limpia el counter
// per-RUT para que un login legítimo no cuente para el lockout (y reduce el DoS
// dirigido: alguien con un RUT conocido ya no acumula intentos contra la víctima
// en cada login exitoso de esta). El per-IP NUNCA se resetea (un éxito puntual no
// perdona el abuso cross-RUT desde la misma IP).
describe('createRateLimitPinMiddleware — reset-on-success per-RUT', () => {
  function makeRedisWithDel(rutCount: number, ipCount: number) {
    const delCalled: string[] = [];
    const pipeline = {
      incr() {
        return this;
      },
      expire() {
        return this;
      },
      async exec(): Promise<unknown[]> {
        return [
          [null, rutCount],
          [null, 1],
          [null, ipCount],
          [null, 1],
        ];
      },
    };
    const redis = {
      multi: () => pipeline,
      del: async (key: string): Promise<number> => {
        delCalled.push(key);
        return 1;
      },
    };
    return { redis, delCalled };
  }

  function makeAppWithStatus(
    mw: ReturnType<typeof createRateLimitPinMiddleware>,
    status: 200 | 401,
  ) {
    const app = new Hono();
    app.use('/x', mw);
    app.post('/x', (c) => c.json({ ok: status < 400 }, status));
    return app;
  }

  it('auth exitoso (2xx) → DEL del counter per-RUT, NO del per-IP', async () => {
    const { redis, delCalled } = makeRedisWithDel(1, 1);
    const mw = createRateLimitPinMiddleware({ redis: redis as never, logger: noopLogger });
    const res = await makeAppWithStatus(mw, 200).request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
    expect(delCalled).toEqual([`${KEY_PREFIX}12345678-5`]);
  });

  it('auth fallido (401) → NO resetea el counter per-RUT', async () => {
    const { redis, delCalled } = makeRedisWithDel(1, 1);
    const mw = createRateLimitPinMiddleware({ redis: redis as never, logger: noopLogger });
    const res = await makeAppWithStatus(mw, 401).request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(401);
    expect(delCalled).toEqual([]);
  });

  it('429 (rate-limited) → NO resetea (el handler no corre)', async () => {
    const { redis, delCalled } = makeRedisWithDel(6, 1); // rutCount 6 > limit 5
    const mw = createRateLimitPinMiddleware({ redis: redis as never, logger: noopLogger });
    const res = await makeAppWithStatus(mw, 200).request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(429);
    expect(delCalled).toEqual([]);
  });

  it('DEL falla en éxito → la respuesta exitosa no se rompe (best-effort)', async () => {
    const pipeline = {
      incr() {
        return this;
      },
      expire() {
        return this;
      },
      async exec(): Promise<unknown[]> {
        return [
          [null, 1],
          [null, 1],
          [null, 1],
          [null, 1],
        ];
      },
    };
    const redis = {
      multi: () => pipeline,
      del: async (): Promise<number> => {
        throw new Error('redis del boom');
      },
    };
    const mw = createRateLimitPinMiddleware({ redis: redis as never, logger: noopLogger });
    const res = await makeAppWithStatus(mw, 200).request('/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });
    expect(res.status).toBe(200);
  });
});
