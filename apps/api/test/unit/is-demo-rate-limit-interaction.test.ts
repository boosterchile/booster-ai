import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { createIsDemoEnforcementMiddleware } from '../../src/middleware/is-demo-enforcement.js';
import { KEY_PREFIX, createRateLimitPinMiddleware } from '../../src/middleware/rate-limit-pin.js';

/**
 * T5 SEC-001 Sprint 2b — integration test T7b (SC-1.3.8).
 *
 * Spec sec-001-cierre §3 H1.3 SC-1.3.8 + spec §10 T7b +
 * plan-sprint-2b §3 T5:
 *
 *   Contract: cuando un path tiene `isDemoEnforcementMiddleware` Y
 *   `rateLimitPinMiddleware` chained (canonical order: is-demo BEFORE
 *   rate-limit), una request con `is_demo:true` claim debe:
 *     1. Retornar 403 forbidden_demo (is-demo fires FIRST).
 *     2. NO incrementar Redis counter `rl:pin-activate:<rutNorm>` (rate-
 *        limit middleware nunca corre).
 *
 *   Razón: rate-limit counter es un recurso escaso compartido entre
 *   usuarios legítimos. Si demo sessions consumen el counter, podrían
 *   exhaust el budget de drivers reales en la misma IP. Defense-in-
 *   depth: bloquear demo ANTES de tocar el rate-limit budget.
 *
 * Diseño fixture-pattern: build canonical middleware chain con real
 * middlewares (createRateLimitPinMiddleware + createIsDemoEnforcement-
 * Middleware) + mock Redis (mismo pattern que rate-limit-pin.test.ts).
 * NO usa /auth/driver-activate real porque ese path no tiene firebase-
 * auth en server.ts (es público para drivers sin Firebase token previo);
 * spec/plan asumió wire global pre-v3.4 amendment. El contract de
 * ordering aplica a CUALQUIER path donde ambos middlewares coexistan.
 *
 * Test relocado a test/unit/ (PO decision 2026-05-26 DB-free).
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

const DEMO_CLAIMS_SHIPPER: FirebaseClaims = {
  uid: 'demo-uid-shipper',
  email: 'demo-2026-shipper@boosterchile.com',
  emailVerified: false,
  name: 'Demo Shipper',
  picture: undefined,
  custom: { is_demo: true, persona: 'generador_carga' },
};

const NON_DEMO_CLAIMS: FirebaseClaims = {
  uid: 'real-driver',
  email: 'real-driver@example.cl',
  emailVerified: true,
  name: 'Real Driver',
  picture: undefined,
  custom: {},
};

interface MockPipelineCalls {
  incrCalled: string[];
  expireCalled: Array<[string, number, string]>;
}

/**
 * Mismo Redis mock pattern que rate-limit-pin.test.ts. Pipeline returns
 * (rutCount, ipCount) per call. Si is-demo bloquea PRIMERO, este mock
 * jamás recibe `.multi()` call y `incrCalled` queda vacío.
 */
function makeRedis(counters: number[] = [1, 1]) {
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

/**
 * Canonical middleware chain mirroring SC-1.3.8 contract:
 *   firebase-auth-mock (sets claims) → is-demo-enforcement → rate-limit-pin → handler
 */
function makeAppWithCanonicalChain(claims: FirebaseClaims | null) {
  const app = new Hono();
  const { redis, calls } = makeRedis([1, 1]);

  // Fake-firebase-auth: setea claims si proveídas (mismo pattern T6/T6b).
  app.use('*', async (c, next) => {
    if (claims) {
      c.set('firebaseClaims', claims);
    }
    await next();
  });

  // is-demo enforcement (mode requireNotDemo, allowlist vacía).
  app.use(
    '*',
    createIsDemoEnforcementMiddleware({
      mode: 'requireNotDemo',
      allowlist: [],
      logger: noopLogger,
    }),
  );

  // rate-limit-pin (real middleware con mock Redis).
  app.use(
    '*',
    createRateLimitPinMiddleware({
      // biome-ignore lint/suspicious/noExplicitAny: mock Redis pattern existente
      redis: redis as any,
      logger: noopLogger,
    }),
  );

  // Handler mock — solo se alcanza si ambos middlewares pasan.
  app.post('/driver-activate-fixture', (c) => c.json({ ok: true }, 200));

  return { app, calls };
}

describe('integration: is-demo + rate-limit interaction (SC-1.3.8 T7b)', () => {
  it('sesión demo + POST → 403 forbidden_demo (is-demo fires FIRST)', async () => {
    const { app, calls } = makeAppWithCanonicalChain(DEMO_CLAIMS_SHIPPER);

    const res = await app.request('/driver-activate-fixture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.error).toBe('forbidden_demo');
    expect(body.code).toBe('forbidden_demo');

    // CRITICAL ASSERTION: rate-limit-pin jamás corrió → Redis multi() nunca llamado.
    expect(calls.incrCalled).toEqual([]);
    expect(calls.expireCalled).toEqual([]);
  });

  it('sesión NO-demo + POST → 200 + rate-limit counter incrementa (control)', async () => {
    const { app, calls } = makeAppWithCanonicalChain(NON_DEMO_CLAIMS);

    const res = await app.request('/driver-activate-fixture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });

    expect(res.status).toBe(200);

    // Rate-limit SÍ corrió → 2 INCR calls (RUT + IP per T10 pattern).
    expect(calls.incrCalled).toHaveLength(2);
    expect(calls.incrCalled[0]).toBe(`${KEY_PREFIX}12345678-5`);
    expect(calls.incrCalled[1]).toMatch(/:ip:/);
  });

  it('claim ausente + POST → 200 + rate-limit counter incrementa', async () => {
    // Request anonymous (sin Bearer token / sin firebase claims). is-demo
    // passthrough porque NO es middleware de auth. rate-limit sí fires.
    const { app, calls } = makeAppWithCanonicalChain(null);

    const res = await app.request('/driver-activate-fixture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '12345678-5' }),
    });

    expect(res.status).toBe(200);
    expect(calls.incrCalled).toHaveLength(2);
  });
});
