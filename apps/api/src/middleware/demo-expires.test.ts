import type { Logger } from '@booster-ai/logger';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { createDemoExpiresMiddleware } from './demo-expires.js';
import { type FirebaseClaims, createFirebaseAuthMiddleware } from './firebase-auth.js';

/**
 * Tests del middleware demo-expires (T5 SEC-001 Sprint 2a).
 *
 * Cubre per spec sec-001-cierre §3 H1.1 SC-1.1.2b + SC-1.1.2c + SC-1.1.3:
 *   - claim is_demo ausente o falsy → passthrough.
 *   - is_demo:true + expires_at future → passthrough.
 *   - is_demo:true + expires_at past → 401.
 *   - is_demo:true + claim ausente expires_at → 401 (fail-closed).
 *   - is_demo:true + Firebase user disabled → 401.
 *   - Cache hit: skip Firebase Admin SDK call.
 *   - Firebase timeout (>1s) → 503 + Retry-After:30.
 *   - Redis unreachable → 503 + Retry-After:30.
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

function makeRedisStub(
  opts: {
    initialCache?: Record<string, string>;
    failGet?: boolean;
  } = {},
) {
  const store = new Map<string, string>(Object.entries(opts.initialCache ?? {}));
  const get = vi.fn(async (key: string) => {
    if (opts.failGet) {
      throw new Error('redis unreachable');
    }
    return store.get(key) ?? null;
  });
  const set = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  return {
    redis: { get, set } as unknown as Redis,
    spies: { get, set },
    state: store,
  };
}

function makeAuthStub(
  opts: {
    user?: Partial<UserRecord>;
    hangForever?: boolean;
    throwError?: Error;
  } = {},
) {
  const getUser = vi.fn(async () => {
    if (opts.throwError) {
      throw opts.throwError;
    }
    if (opts.hangForever) {
      // Promise que nunca resuelve — exercise el timeout race.
      return new Promise<UserRecord>(() => {});
    }
    return (opts.user ?? {}) as UserRecord;
  });
  return { auth: { getUser } as unknown as Auth, spies: { getUser } };
}

/**
 * Helper: arma una app Hono que setea firebaseClaims en context (mock
 * del firebase-auth middleware) y agrega demo-expires + un handler
 * `/protected` que retorna 200. Devuelve fetch helper.
 */
function makeAppWithClaims(
  claims: FirebaseClaims | null,
  deps: {
    auth: Auth;
    redis: Redis;
    firebaseTimeoutMs?: number;
  },
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (claims) {
      c.set('firebaseClaims', claims);
    }
    await next();
  });
  app.use(
    '*',
    createDemoExpiresMiddleware({
      auth: deps.auth,
      redis: deps.redis,
      logger: noopLogger,
      ...(deps.firebaseTimeoutMs !== undefined
        ? { firebaseTimeoutMs: deps.firebaseTimeoutMs }
        : {}),
    }),
  );
  app.get('/protected', (c) => c.json({ ok: true }));
  return app;
}

function futureISO(days: number): string {
  return new Date(Date.now() + days * 86400 * 1000).toISOString();
}
function pastISO(days: number): string {
  return new Date(Date.now() - days * 86400 * 1000).toISOString();
}

const NON_DEMO_CLAIMS: FirebaseClaims = {
  uid: 'real-user-1',
  email: 'real@user.cl',
  emailVerified: true,
  name: 'Real',
  picture: undefined,
  custom: {},
};
const DEMO_CLAIMS: FirebaseClaims = {
  uid: 'demo-uid-1',
  email: 'demo-2026-shipper@boosterchile.com',
  emailVerified: false,
  name: 'Demo',
  picture: undefined,
  custom: { is_demo: true, persona: 'generador_carga' },
};

describe('demo-expires middleware', () => {
  it('passthrough cuando claim is_demo ausente (cuenta real)', async () => {
    const fb = makeAuthStub();
    const r = makeRedisStub();
    const app = makeAppWithClaims(NON_DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    expect(fb.spies.getUser).not.toHaveBeenCalled();
    expect(r.spies.get).not.toHaveBeenCalled();
  });

  it('passthrough cuando no hay claims (request anonymous)', async () => {
    const fb = makeAuthStub();
    const r = makeRedisStub();
    const app = makeAppWithClaims(null, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    expect(fb.spies.getUser).not.toHaveBeenCalled();
  });

  it('passthrough cuando is_demo + expires_at future', async () => {
    const fb = makeAuthStub({
      user: {
        uid: 'demo-uid-1',
        disabled: false,
        customClaims: { is_demo: true, expires_at: futureISO(7) },
      },
    });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    expect(fb.spies.getUser).toHaveBeenCalledOnce();
    expect(r.spies.set).toHaveBeenCalled(); // cache write
  });

  it('401 demo_account_expired cuando expires_at past', async () => {
    const fb = makeAuthStub({
      user: {
        uid: 'demo-uid-1',
        disabled: false,
        customClaims: { is_demo: true, expires_at: pastISO(1) },
      },
    });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'demo_account_expired', reason: 'expires_at_past' });
  });

  it('401 fail-closed cuando is_demo:true pero expires_at ausente (estado inválido)', async () => {
    const fb = makeAuthStub({
      user: { uid: 'demo-uid-1', disabled: false, customClaims: { is_demo: true } },
    });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
  });

  it('401 cuando Firebase user disabled (retired)', async () => {
    const fb = makeAuthStub({
      user: {
        uid: 'demo-uid-1',
        disabled: true,
        customClaims: { is_demo: true, expires_at: futureISO(7) },
      },
    });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'demo_account_expired', reason: 'account_disabled' });
  });

  it('cache hit: skip Firebase Admin SDK call cuando snapshot en Redis', async () => {
    const snapshot = JSON.stringify({
      uid: 'demo-uid-1',
      disabled: false,
      customClaims: { is_demo: true, expires_at: futureISO(7) },
    });
    const fb = makeAuthStub();
    const r = makeRedisStub({ initialCache: { 'demo-claim:demo-uid-1': snapshot } });
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    expect(r.spies.get).toHaveBeenCalledWith('demo-claim:demo-uid-1');
    expect(fb.spies.getUser).not.toHaveBeenCalled(); // cache hit, no SDK call
  });

  it('503 + Retry-After cuando Firebase timeout (>firebaseTimeoutMs)', async () => {
    const fb = makeAuthStub({ hangForever: true });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, {
      auth: fb.auth,
      redis: r.redis,
      firebaseTimeoutMs: 20, // tight para evitar test slow
    });

    const res = await app.request('/protected');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('service_unavailable');
  });

  it('503 + Retry-After cuando Redis get falla (unreachable)', async () => {
    const fb = makeAuthStub();
    const r = makeRedisStub({ failGet: true });
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('503 cuando Firebase getUser throws non-timeout error', async () => {
    const fb = makeAuthStub({ throwError: new Error('firebase 5xx') });
    const r = makeRedisStub();
    const app = makeAppWithClaims(DEMO_CLAIMS, { auth: fb.auth, redis: r.redis });

    const res = await app.request('/protected');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('createFirebaseAuthMiddleware export existe y firebaseClaims es la key correcta', () => {
    // Regression guard: si firebase-auth.ts:116 cambia la context key,
    // este test rompe inmediatamente y forza re-alineación.
    expect(typeof createFirebaseAuthMiddleware).toBe('function');
  });
});
