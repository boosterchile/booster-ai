import type { Logger } from '@booster-ai/logger';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { createDemoCacheWarmRoutes } from './demo-cache-warm.js';

/**
 * Tests del endpoint GET /cache-warm/:persona (T5 SEC-001 Sprint 2a).
 *
 * Cubre: validation persona, lookup cuentas_demo, Firebase fetch,
 * Redis cache write, IP rate-limit, edge cases (no row / disabled).
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

function makeRedisStub(opts: { rateLimitCount?: number } = {}) {
  const store = new Map<string, string>();
  const counter = { value: opts.rateLimitCount ?? 0 };
  const set = vi.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  const exec = vi.fn(async () => {
    counter.value += 1;
    return [
      [null, counter.value],
      [null, 'OK'],
    ];
  });
  const multi = vi.fn(() => ({
    incr: vi.fn(),
    expire: vi.fn(),
    exec,
  }));
  return {
    redis: { set, multi } as unknown as Redis,
    spies: { set, multi, exec },
    state: { store, counter },
  };
}

function makeAuthStub(opts: { user?: Partial<UserRecord>; throwError?: Error } = {}) {
  const getUser = vi.fn(async () => {
    if (opts.throwError) {
      throw opts.throwError;
    }
    return (opts.user ?? { uid: 'fb-1', disabled: false, customClaims: {} }) as UserRecord;
  });
  return { auth: { getUser } as unknown as Auth, spies: { getUser } };
}

interface DbRow {
  firebaseUid: string | null;
}

function makeDbStub(rows: DbRow[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select } as unknown as Parameters<typeof createDemoCacheWarmRoutes>[0]['db'],
    spies: { select, from, where, limit },
  };
}

describe('demo-cache-warm endpoint', () => {
  it('204 happy path: persona válida + cuenta_demo active + Firebase OK → cache write', async () => {
    const r = makeRedisStub();
    const a = makeAuthStub({
      user: { uid: 'fb-1', disabled: false, customClaims: { is_demo: true } },
    });
    const d = makeDbStub([{ firebaseUid: 'fb-1' }]);
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/generador_carga');
    expect(res.status).toBe(204);
    expect(r.spies.set).toHaveBeenCalledWith('demo-claim:fb-1', expect.any(String), 'EX', 60);
  });

  it('400 persona inválida (no es Spanish enum value)', async () => {
    const r = makeRedisStub();
    const a = makeAuthStub();
    const d = makeDbStub([]);
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/shipper'); // English value, no permitido
    expect(res.status).toBe(400);
  });

  it('204 idempotent: sin active row → skip cache write (no-op)', async () => {
    const r = makeRedisStub();
    const a = makeAuthStub();
    const d = makeDbStub([]); // cuentas_demo sin rows active
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/transportista');
    expect(res.status).toBe(204);
    expect(a.spies.getUser).not.toHaveBeenCalled();
    expect(r.spies.set).not.toHaveBeenCalled();
  });

  it('204 cuando firebase_uid es null (pre-T4 recreate state)', async () => {
    const r = makeRedisStub();
    const a = makeAuthStub();
    const d = makeDbStub([{ firebaseUid: null }]); // row existe pero sin uid
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/stakeholder');
    expect(res.status).toBe(204);
    expect(a.spies.getUser).not.toHaveBeenCalled();
  });

  it('503 cuando Firebase getUser throws (caller no diferencia desde fire-and-forget)', async () => {
    const r = makeRedisStub();
    const a = makeAuthStub({ throwError: new Error('firebase 5xx') });
    const d = makeDbStub([{ firebaseUid: 'fb-broken' }]);
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/conductor');
    expect(res.status).toBe(503);
  });

  it('429 IP rate-limit cuando count > 10 en ventana 60s', async () => {
    const r = makeRedisStub({ rateLimitCount: 10 }); // próximo incr → 11 > limit
    const a = makeAuthStub();
    const d = makeDbStub([{ firebaseUid: 'fb-1' }]);
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/generador_carga', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(a.spies.getUser).not.toHaveBeenCalled(); // bloqueado antes de Firebase call
  });

  it('proceed cuando Redis pipeline fails (rate-limit degraded path)', async () => {
    const failExec = vi.fn(async () => {
      throw new Error('redis pipeline broken');
    });
    const r = {
      redis: {
        set: vi.fn(async () => 'OK'),
        multi: vi.fn(() => ({ incr: vi.fn(), expire: vi.fn(), exec: failExec })),
      } as unknown as Redis,
    };
    const a = makeAuthStub({ user: { uid: 'fb-1', disabled: false, customClaims: {} } });
    const d = makeDbStub([{ firebaseUid: 'fb-1' }]);
    const app = createDemoCacheWarmRoutes({
      db: d.db,
      auth: a.auth,
      redis: r.redis,
      logger: noopLogger,
    });

    const res = await app.request('/cache-warm/generador_carga');
    expect(res.status).toBe(204); // procede al cache-warm aunque rate-limit falló
    expect(a.spies.getUser).toHaveBeenCalled();
  });
});
