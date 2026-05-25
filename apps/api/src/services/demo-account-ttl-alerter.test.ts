import type { Logger } from '@booster-ai/logger';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import type Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runDemoTtlAlerter } from './demo-account-ttl-alerter.js';

/**
 * Tests del service demo-account-ttl-alerter (T6a SEC-001 Sprint 2a).
 *
 * Cubre per spec sec-001-cierre §3 H1.1 SC-1.1.6:
 *   - 4 UIDs con expires_at variado (40d, 7d, 3d, 1d) → alerta solo
 *     los ≤7.
 *   - Dedup: segunda corrida mismo día no emite alerts.
 *   - expires_at ausente o no parseable → counter error + log warn.
 *   - Firebase getUser throws → counter error, sigue con los demás.
 *   - structured log incluye `event: "demo.ttl_low"` (necesario para
 *     log-based metric filter).
 */

let warnSpy: ReturnType<typeof vi.fn>;
let infoSpy: ReturnType<typeof vi.fn>;
let errorSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  warnSpy = vi.fn();
  infoSpy = vi.fn();
  errorSpy = vi.fn();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeLoggerSpy() {
  const noop = (): void => undefined;
  const child = () => loggerObj;
  const loggerObj: Logger = {
    trace: noop,
    debug: noop,
    info: infoSpy,
    warn: warnSpy,
    error: errorSpy,
    fatal: noop,
    child,
  } as unknown as Logger;
  return loggerObj;
}

function makeDbStub(rows: Array<{ persona: string; firebaseUid: string | null }>) {
  const where = vi.fn(async () => rows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: { select } as unknown as Parameters<typeof runDemoTtlAlerter>[0]['db'],
    spies: { select, from, where },
  };
}

function makeAuthStub(usersByUid: Map<string, Partial<UserRecord>>) {
  const getUser = vi.fn(async (uid: string) => {
    const found = usersByUid.get(uid);
    if (!found) {
      throw new Error('firebase getUser: not found');
    }
    return found as UserRecord;
  });
  return { auth: { getUser } as unknown as Auth, spies: { getUser } };
}

function makeRedisStub() {
  const store = new Map<string, string>();
  const set = vi.fn(async (key: string, _v: string, ..._opts: unknown[]) => {
    if (store.has(key)) {
      return null; // NX behavior: si existe, retorna null
    }
    store.set(key, '1');
    return 'OK';
  });
  return { redis: { set } as unknown as Redis, spies: { set }, state: store };
}

function futureISO(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('demo-account-ttl-alerter', () => {
  it('happy path: 4 UIDs con expires_at variado (40d, 7d, 3d, 1d) → alerta solo los ≤7', async () => {
    const rows = [
      { persona: 'generador_carga', firebaseUid: 'uid-shipper' },
      { persona: 'transportista', firebaseUid: 'uid-carrier' },
      { persona: 'stakeholder', firebaseUid: 'uid-stake' },
      { persona: 'conductor', firebaseUid: 'uid-conductor' },
    ];
    const usersByUid = new Map<string, Partial<UserRecord>>([
      ['uid-shipper', { uid: 'uid-shipper', customClaims: { expires_at: futureISO(40) } }],
      ['uid-carrier', { uid: 'uid-carrier', customClaims: { expires_at: futureISO(7) } }],
      ['uid-stake', { uid: 'uid-stake', customClaims: { expires_at: futureISO(3) } }],
      ['uid-conductor', { uid: 'uid-conductor', customClaims: { expires_at: futureISO(1) } }],
    ]);

    const d = makeDbStub(rows);
    const a = makeAuthStub(usersByUid);
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const result = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });

    expect(result.scanned).toBe(4);
    expect(result.alerted).toBe(3); // 7d, 3d, 1d
    expect(result.skippedSafe).toBe(1); // 40d
    expect(result.deduplicated).toBe(0);
    expect(result.errors).toBe(0);

    // Cada alert debe tener structured field `event: "demo.ttl_low"`
    // para que el log-based metric filter matchee.
    const alertCalls = warnSpy.mock.calls.filter((call) => {
      const obj = call[0] as Record<string, unknown>;
      return obj && obj.event === 'demo.ttl_low';
    });
    expect(alertCalls).toHaveLength(3);
  });

  it('dedup: segunda corrida mismo día emite 0 alerts (Redis NX devuelve null)', async () => {
    const rows = [{ persona: 'generador_carga', firebaseUid: 'uid-shipper' }];
    const usersByUid = new Map<string, Partial<UserRecord>>([
      ['uid-shipper', { uid: 'uid-shipper', customClaims: { expires_at: futureISO(3) } }],
    ]);
    const d = makeDbStub(rows);
    const a = makeAuthStub(usersByUid);
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const first = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(first.alerted).toBe(1);
    expect(first.deduplicated).toBe(0);

    // Segunda corrida con MISMA state Redis → dedup.
    const second = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(second.alerted).toBe(0);
    expect(second.deduplicated).toBe(1);
  });

  it('expires_at ausente → contador error + warn (NO alert)', async () => {
    const rows = [{ persona: 'generador_carga', firebaseUid: 'uid-no-claim' }];
    const usersByUid = new Map<string, Partial<UserRecord>>([
      ['uid-no-claim', { uid: 'uid-no-claim', customClaims: {} }],
    ]);
    const d = makeDbStub(rows);
    const a = makeAuthStub(usersByUid);
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const result = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(result.alerted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('expires_at no parseable → contador error', async () => {
    const rows = [{ persona: 'generador_carga', firebaseUid: 'uid-bad-date' }];
    const usersByUid = new Map<string, Partial<UserRecord>>([
      ['uid-bad-date', { uid: 'uid-bad-date', customClaims: { expires_at: 'not-a-date' } }],
    ]);
    const d = makeDbStub(rows);
    const a = makeAuthStub(usersByUid);
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const result = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(result.alerted).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('Firebase getUser falla en un UID → counter error, sigue con los demás', async () => {
    const rows = [
      { persona: 'generador_carga', firebaseUid: 'uid-broken' },
      { persona: 'transportista', firebaseUid: 'uid-good' },
    ];
    const usersByUid = new Map<string, Partial<UserRecord>>([
      // 'uid-broken' no en map → getUser throws
      ['uid-good', { uid: 'uid-good', customClaims: { expires_at: futureISO(1) } }],
    ]);
    const d = makeDbStub(rows);
    const a = makeAuthStub(usersByUid);
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const result = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(result.scanned).toBe(2);
    expect(result.errors).toBe(1);
    expect(result.alerted).toBe(1); // uid-good alerta
  });

  it('filtra rows con firebase_uid null (estado pre-T4 recreate)', async () => {
    const rows = [
      { persona: 'generador_carga', firebaseUid: null },
      { persona: 'transportista', firebaseUid: null },
    ];
    const d = makeDbStub(rows);
    const a = makeAuthStub(new Map());
    const r = makeRedisStub();
    const logger = makeLoggerSpy();

    const result = await runDemoTtlAlerter({
      db: d.db,
      firebaseAuth: a.auth,
      redis: r.redis,
      logger,
    });
    expect(result.scanned).toBe(0); // null uids filtrados
    expect(result.alerted).toBe(0);
  });
});
