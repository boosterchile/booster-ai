import type { Auth, UserRecord } from 'firebase-admin/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OLD_DEMO_UIDS,
  recreateAll,
  renew,
  retire,
  retireOldBatch,
} from './harden-demo-accounts.js';

/**
 * Tests del service module `harden-demo-accounts` (T4 SEC-001 Sprint 2a).
 *
 * Mocks Firebase Admin Auth (getUser/getUserByEmail/createUser/updateUser/
 * setCustomUserClaims) y Drizzle (insert+onConflictDoNothing, update+
 * set+where) para validar:
 *   - recreateAll: happy path, idempotent skip, dry-run, mixed state,
 *     disabled state alert.
 *   - retire: happy path, idempotent already_disabled, not_found, dry-run.
 *   - retireOldBatch: happy path 4 retired, partial-recovery (2 already
 *     disabled + 2 active).
 *   - renew: happy path, disabled, not_found.
 *
 * El env var lookup en `getPasswordForPersona` requiere los 4 env vars
 * mountados — test/setup.ts los pre-seedea con valores test-only.
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
} as unknown as Parameters<typeof recreateAll>[0]['logger'];

interface FbStubOpts {
  existingByEmail?: Map<string, Partial<UserRecord>>;
  existingByUid?: Map<string, Partial<UserRecord>>;
  createdUids?: string[];
}

function makeFirebaseStub(opts: FbStubOpts = {}) {
  const byEmail = new Map(opts.existingByEmail ?? []);
  const byUid = new Map(opts.existingByUid ?? []);
  const createdQueue = [...(opts.createdUids ?? [])];

  const getUserByEmail = vi.fn(async (email: string) => {
    const found = byEmail.get(email);
    if (found) {
      return found as UserRecord;
    }
    throw new Error('not-found');
  });
  const getUser = vi.fn(async (uid: string) => {
    const found = byUid.get(uid);
    if (found) {
      return found as UserRecord;
    }
    throw new Error('not-found');
  });
  const createUser = vi.fn(async (props: { email: string; password: string }) => {
    const uid = createdQueue.shift() ?? `fb-uid-${createUser.mock.calls.length}`;
    const rec = {
      uid,
      email: props.email,
      disabled: false,
      customClaims: {},
    } as Partial<UserRecord>;
    byEmail.set(props.email, rec);
    byUid.set(uid, rec);
    return rec as UserRecord;
  });
  const updateUser = vi.fn(async (uid: string, props: Partial<UserRecord>) => {
    const existing = byUid.get(uid);
    if (existing) {
      Object.assign(existing, props);
    }
    return (existing ?? {}) as UserRecord;
  });
  const setCustomUserClaims = vi.fn(async (uid: string, claims: Record<string, unknown>) => {
    const existing = byUid.get(uid);
    if (existing) {
      // UserRecord.customClaims es readonly — cast a mutable para el mock.
      (existing as { customClaims?: unknown }).customClaims = claims;
    }
  });

  return {
    auth: {
      getUserByEmail,
      getUser,
      createUser,
      updateUser,
      setCustomUserClaims,
    } as unknown as Auth,
    spies: { getUserByEmail, getUser, createUser, updateUser, setCustomUserClaims },
    state: { byEmail, byUid },
  };
}

interface DbStubOpts {
  cuentaDemoSelectQueue?: Array<Array<{ email: string }>>;
}

function makeDbStub(opts: DbStubOpts = {}) {
  const selectQueue = [...(opts.cuentaDemoSelectQueue ?? [])];

  const limit = vi.fn(async () => selectQueue.shift() ?? []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const onConflictDoNothing = vi.fn(async () => undefined);
  const insertValues = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateWhere = vi.fn(async () => undefined);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    db: { select, insert, update } as unknown as Parameters<typeof recreateAll>[0]['db'],
    spies: { select, insert, insertValues, onConflictDoNothing, update, updateSet, updateWhere },
  };
}

beforeEach(() => {
  // test/setup.ts ya pre-seedea los 4 env vars con valores test-only;
  // re-aseguramos en caso de que un test previo haya stubed vacío.
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD_SHIPPER_2026', 'test-pw-shipper');
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD_CARRIER_2026', 'test-pw-carrier');
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026', 'test-pw-stakeholder');
  vi.stubEnv('DEMO_ACCOUNT_PASSWORD_CONDUCTOR_FIREBASE_2026', 'test-pw-conductor');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('recreateAll', () => {
  it('happy path: 4 personas, none exist → 4 created + claims + DB synced', async () => {
    const fb = makeFirebaseStub({ createdUids: ['uid-1', 'uid-2', 'uid-3', 'uid-4'] });
    // cuentas_demo SELECT vacíos × 4 → lookupOrCreateCuentaDemoEmail INSERTs.
    const dbStub = makeDbStub({ cuentaDemoSelectQueue: [[], [], [], []] });

    const result = await recreateAll({ db: dbStub.db, firebaseAuth: fb.auth, logger: noopLogger });

    expect(result.created).toBe(4);
    expect(result.skipped).toBe(0);
    expect(fb.spies.createUser).toHaveBeenCalledTimes(4);
    expect(fb.spies.setCustomUserClaims).toHaveBeenCalledTimes(4);
    expect(dbStub.spies.update).toHaveBeenCalledTimes(4); // UPDATE firebase_uid en cuentas_demo
    // Claims structure
    const lastClaims = fb.spies.setCustomUserClaims.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(lastClaims).toMatchObject({ is_demo: true, persona: 'generador_carga' });
    expect(lastClaims.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('idempotent: 4 personas existen active → 4 skipped, cero createUser', async () => {
    const fb = makeFirebaseStub({
      existingByEmail: new Map([
        ['demo-2026-shipper@boosterchile.com', { uid: 'uid-1', disabled: false }],
        ['demo-2026-carrier@boosterchile.com', { uid: 'uid-2', disabled: false }],
        ['demo-2026-stakeholder@boosterchile.com', { uid: 'uid-3', disabled: false }],
        ['drivers+demo-2026-conductor@boosterchile.invalid', { uid: 'uid-4', disabled: false }],
      ]),
    });
    const dbStub = makeDbStub({ cuentaDemoSelectQueue: [[], [], [], []] });

    const result = await recreateAll({ db: dbStub.db, firebaseAuth: fb.auth, logger: noopLogger });

    expect(result.created).toBe(0);
    expect(result.skipped).toBe(4);
    expect(fb.spies.createUser).not.toHaveBeenCalled();
    expect(fb.spies.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('dry-run: 4 would-create but cero SDK writes', async () => {
    const fb = makeFirebaseStub();
    const dbStub = makeDbStub({ cuentaDemoSelectQueue: [[], [], [], []] });

    const result = await recreateAll({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      dryRun: true,
    });

    expect(result.created).toBe(4);
    expect(result.emails.every((e) => e.firebaseUid === null)).toBe(true);
    expect(fb.spies.createUser).not.toHaveBeenCalled();
    expect(fb.spies.setCustomUserClaims).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
  });

  it('mixed state: 2 existen active + 2 new → 2 skipped + 2 created', async () => {
    const fb = makeFirebaseStub({
      existingByEmail: new Map([
        ['demo-2026-shipper@boosterchile.com', { uid: 'uid-shipper-existing', disabled: false }],
        ['demo-2026-stakeholder@boosterchile.com', { uid: 'uid-stk-existing', disabled: false }],
      ]),
      createdUids: ['uid-new-carrier', 'uid-new-conductor'],
    });
    const dbStub = makeDbStub({ cuentaDemoSelectQueue: [[], [], [], []] });

    const result = await recreateAll({ db: dbStub.db, firebaseAuth: fb.auth, logger: noopLogger });

    expect(result.skipped).toBe(2);
    expect(result.created).toBe(2);
    expect(fb.spies.createUser).toHaveBeenCalledTimes(2);
  });

  it('disabled state alert: persona email existe pero disabled → skip + warn (NO recreate)', async () => {
    const fb = makeFirebaseStub({
      existingByEmail: new Map([
        ['demo-2026-shipper@boosterchile.com', { uid: 'uid-disabled-1', disabled: true }],
      ]),
      createdUids: ['uid-2', 'uid-3', 'uid-4'],
    });
    const dbStub = makeDbStub({ cuentaDemoSelectQueue: [[], [], [], []] });

    const result = await recreateAll({ db: dbStub.db, firebaseAuth: fb.auth, logger: noopLogger });

    // 1 skipped (shipper disabled) + 3 created
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(3);
    expect(fb.spies.createUser).toHaveBeenCalledTimes(3);
  });
});

describe('retire', () => {
  it('happy path: UID active → disabled + audit log + cuentas_demo synced', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [
          'uid-test',
          { uid: 'uid-test', email: 'x@y.cl', disabled: false, customClaims: { is_demo: true } },
        ],
      ]),
    });
    const dbStub = makeDbStub();

    const result = await retire({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-test',
    });

    expect(result.status).toBe('retired');
    expect(fb.spies.updateUser).toHaveBeenCalledWith('uid-test', { disabled: true });
    expect(fb.spies.setCustomUserClaims).toHaveBeenCalled();
    const claims = fb.spies.setCustomUserClaims.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(claims.is_demo).toBe(true); // preserva existing claim
    expect(claims.audit_demo_uid_retired).toBeDefined();
    expect(dbStub.spies.update).toHaveBeenCalled();
  });

  it('idempotent: UID already disabled → skip + no writes', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([['uid-disabled', { uid: 'uid-disabled', disabled: true }]]),
    });
    const dbStub = makeDbStub();

    const result = await retire({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-disabled',
    });

    expect(result.status).toBe('already_disabled');
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
  });

  it('not_found: UID inexistente → status not_found, no writes', async () => {
    const fb = makeFirebaseStub();
    const dbStub = makeDbStub();

    const result = await retire({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-nonexistent',
    });

    expect(result.status).toBe('not_found');
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
  });

  it('dry-run: no SDK ni DB writes', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([['uid-test', { uid: 'uid-test', disabled: false }]]),
    });
    const dbStub = makeDbStub();

    const result = await retire({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-test',
      dryRun: true,
    });

    expect(result.status).toBe('retired');
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
  });
});

describe('retireOldBatch', () => {
  it('happy path: 4 UIDs viejas active → 4 retired', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map(OLD_DEMO_UIDS.map((uid) => [uid, { uid, disabled: false }])),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
    });

    expect(result.retired).toBe(4);
    expect(result.skippedAlreadyDisabled).toBe(0);
    expect(result.failed).toEqual([]);
    expect(fb.spies.updateUser).toHaveBeenCalledTimes(4);
  });

  it('partial-recovery: 2 ya disabled + 2 active → 2 skipped + 2 retired (resume-friendly)', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [OLD_DEMO_UIDS[0], { uid: OLD_DEMO_UIDS[0], disabled: true }],
        [OLD_DEMO_UIDS[1], { uid: OLD_DEMO_UIDS[1], disabled: false }],
        [OLD_DEMO_UIDS[2], { uid: OLD_DEMO_UIDS[2], disabled: true }],
        [OLD_DEMO_UIDS[3], { uid: OLD_DEMO_UIDS[3], disabled: false }],
      ]),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
    });

    expect(result.retired).toBe(2);
    expect(result.skippedAlreadyDisabled).toBe(2);
    expect(result.failed).toEqual([]);
    expect(fb.spies.updateUser).toHaveBeenCalledTimes(2);
  });

  it('dry-run: 4 UIDs viejas active → 4 retired (simulado), cero SDK writes', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map(OLD_DEMO_UIDS.map((uid) => [uid, { uid, disabled: false }])),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      dryRun: true,
    });

    expect(result.retired).toBe(4);
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
  });

  it('mixed: UID inexistente cuenta como failed.not_found, batch continúa', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [OLD_DEMO_UIDS[0], { uid: OLD_DEMO_UIDS[0], disabled: false }],
        [OLD_DEMO_UIDS[2], { uid: OLD_DEMO_UIDS[2], disabled: false }],
        // OLD_DEMO_UIDS[1] y [3] no existen
      ]),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
    });

    expect(result.retired).toBe(2);
    expect(result.skippedAlreadyDisabled).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]?.reason).toBe('not_found');
  });
});

describe('renew', () => {
  it('happy path: UID active → expires_at extended', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [
          'uid-test',
          { uid: 'uid-test', disabled: false, customClaims: { is_demo: true, persona: 'shipper' } },
        ],
      ]),
    });
    const dbStub = makeDbStub();

    const result = await renew({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-test',
      extendDays: 60,
    });

    expect(result.status).toBe('renewed');
    expect(result.newExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fb.spies.setCustomUserClaims).toHaveBeenCalled();
    const claims = fb.spies.setCustomUserClaims.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(claims.is_demo).toBe(true); // preserva
    expect(claims.persona).toBe('shipper');
    expect(claims.expires_at).toBe(result.newExpiresAt);
  });

  it('disabled: UID disabled → status disabled, no setClaims', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([['uid-disabled', { uid: 'uid-disabled', disabled: true }]]),
    });
    const dbStub = makeDbStub();

    const result = await renew({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-disabled',
      extendDays: 30,
    });

    expect(result.status).toBe('disabled');
    expect(fb.spies.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('not_found: UID inexistente → status not_found', async () => {
    const fb = makeFirebaseStub();
    const dbStub = makeDbStub();

    const result = await renew({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-nonexistent',
      extendDays: 30,
    });

    expect(result.status).toBe('not_found');
    expect(fb.spies.setCustomUserClaims).not.toHaveBeenCalled();
  });

  it('dry-run: no setClaims', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([['uid-test', { uid: 'uid-test', disabled: false }]]),
    });
    const dbStub = makeDbStub();

    const result = await renew({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      uid: 'uid-test',
      extendDays: 30,
      dryRun: true,
    });

    expect(result.status).toBe('renewed');
    expect(fb.spies.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
