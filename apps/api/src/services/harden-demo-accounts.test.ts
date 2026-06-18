import { parseEnv } from '@booster-ai/config';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiEnvSchema } from '../config.js';
import * as harden from './harden-demo-accounts.js';
import {
  getDemoOldUids,
  recreateAll,
  renew,
  retire,
  retireOldBatch,
} from './harden-demo-accounts.js';

/**
 * Tests del service module `harden-demo-accounts` (T4 SEC-001 Sprint 2a;
 * F2 P0-C — `.specs/p0c-uids-demo-secret-manager/spec.md`).
 *
 * Mocks Firebase Admin Auth (getUser/getUserByEmail/createUser/updateUser/
 * setCustomUserClaims) y Drizzle (insert+onConflictDoNothing, update+
 * set+where) para validar:
 *   - recreateAll: happy path, idempotent skip, dry-run, mixed state,
 *     disabled state alert.
 *   - retire: happy path, idempotent already_disabled, not_found, dry-run.
 *   - retireOldBatch: happy path 4 retired, partial-recovery, dry-run,
 *     not_found, no-op seguro con lista vacía/ausente.
 *   - renew: happy path, disabled, not_found.
 *   - getDemoOldUids: parser Zod de la env DEMO_OLD_UIDS (F2 P0-C).
 *
 * F2 P0-C: los 4 UIDs reales (PII, Ley 19.628) ya NO viven en el código.
 * Los tests inyectan 4 UIDs DE PRUEBA vía `opts.oldUids` (NO los reales);
 * el parser se prueba con CSVs sintéticos.
 *
 * El env var lookup en `getPasswordForPersona` requiere los 4 env vars
 * mountados — test/setup.ts los pre-seedea con valores test-only.
 */

/** 4 UIDs DE PRUEBA (28 chars alfanuméricos), NO los reales. */
const TEST_OLD_UIDS = [
  'demoUidShipperAAAAAAAAAAAAAAA',
  'demoUidStakeholderBBBBBBBBBBB',
  'demoUidCarrierCCCCCCCCCCCCCCC',
  'demoUidConductorDDDDDDDDDDDDD',
] as const;

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

// ===========================================================================
// Grupo A — parser de la env (getDemoOldUids / demoOldUidsSchema)
// F2 P0-C: la lista de UIDs viejas viene de DEMO_OLD_UIDS (CSV validada).
// ===========================================================================
describe('getDemoOldUids (parser DEMO_OLD_UIDS)', () => {
  it('A1: CSV de 4 UIDs válidos → array de 4 strings en orden', () => {
    const csv = TEST_OLD_UIDS.join(',');
    expect(getDemoOldUids({ DEMO_OLD_UIDS: csv })).toEqual([...TEST_OLD_UIDS]);
  });

  it('A2: env ausente (undefined) → [] (no lanza)', () => {
    expect(getDemoOldUids({})).toEqual([]);
  });

  it('A3: env vacía ("") → [] (no lanza)', () => {
    expect(getDemoOldUids({ DEMO_OLD_UIDS: '' })).toEqual([]);
  });

  it('A4: CSV con espacios → trimmed', () => {
    expect(
      getDemoOldUids({ DEMO_OLD_UIDS: ` ${TEST_OLD_UIDS[0]} , ${TEST_OLD_UIDS[1]} ` }),
    ).toEqual([TEST_OLD_UIDS[0], TEST_OLD_UIDS[1]]);
  });

  it('A5a: UID con guión → throw Zod (no lo acepta)', () => {
    expect(() => getDemoOldUids({ DEMO_OLD_UIDS: 'invalid-uid-with-dashes-0000' })).toThrow();
  });

  it('A5b: UID con menos de 20 chars → throw Zod', () => {
    expect(() => getDemoOldUids({ DEMO_OLD_UIDS: 'tooShort123' })).toThrow();
  });

  it('A5c: UID con @ → throw Zod', () => {
    expect(() => getDemoOldUids({ DEMO_OLD_UIDS: 'demo@boosterchile.com00000000' })).toThrow();
  });

  it('A6: elemento vacío entre comas → filtra el vacío', () => {
    expect(getDemoOldUids({ DEMO_OLD_UIDS: `${TEST_OLD_UIDS[0]},,${TEST_OLD_UIDS[1]}` })).toEqual([
      TEST_OLD_UIDS[0],
      TEST_OLD_UIDS[1],
    ]);
  });

  it('A7: default source = process.env (sin arg) → no lanza', () => {
    vi.stubEnv('DEMO_OLD_UIDS', '');
    expect(getDemoOldUids()).toEqual([]);
  });
});

// ===========================================================================
// Grupo B — config.ts rechaza arranque con env inválida
// (defensa en profundidad runtime API; spec §9.2)
// ===========================================================================
describe('config.ts DEMO_OLD_UIDS (fail-fast en startup)', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  // Base válida: process.env ya está poblada por test/setup.ts con todos los
  // requeridos del apiEnvSchema. Override solo DEMO_OLD_UIDS por test.
  // (Para el caso "ausente" omitimos la key; el schema trata undefined → []).
  function sourceWith(demoOldUids: string | undefined): NodeJS.ProcessEnv {
    const { DEMO_OLD_UIDS: _omit, ...rest } = process.env;
    return demoOldUids === undefined ? rest : { ...rest, DEMO_OLD_UIDS: demoOldUids };
  }

  it('B7: DEMO_OLD_UIDS malformada → parseEnv falla → process.exit(1)', () => {
    expect(() => parseEnv(apiEnvSchema, sourceWith('invalid-uid-dashes-0000'))).toThrow(
      'process.exit called',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('B8: DEMO_OLD_UIDS ausente → arranca OK, config.DEMO_OLD_UIDS === []', () => {
    const env = parseEnv(apiEnvSchema, sourceWith(undefined));
    expect(env.DEMO_OLD_UIDS).toEqual([]);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('B9: DEMO_OLD_UIDS CSV válida → config.DEMO_OLD_UIDS = array de N UIDs', () => {
    const env = parseEnv(apiEnvSchema, sourceWith(TEST_OLD_UIDS.join(',')));
    expect(env.DEMO_OLD_UIDS).toEqual([...TEST_OLD_UIDS]);
    expect(exitSpy).not.toHaveBeenCalled();
  });
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

// ===========================================================================
// Grupo C — retireOldBatch aplica el hardening igual que antes
// (paridad con tests previos, ahora con UIDs DE PRUEBA inyectados vía opts).
// ===========================================================================
describe('retireOldBatch (UIDs inyectados vía opts.oldUids)', () => {
  it('C10: 4 UIDs de prueba active → 4 retired, updateUser 4 veces', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map(TEST_OLD_UIDS.map((uid) => [uid, { uid, disabled: false }])),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      oldUids: TEST_OLD_UIDS,
    });

    expect(result.retired).toBe(4);
    expect(result.skippedAlreadyDisabled).toBe(0);
    expect(result.failed).toEqual([]);
    expect(fb.spies.updateUser).toHaveBeenCalledTimes(4);
  });

  it('C11: partial-recovery: 2 ya disabled + 2 active → 2 retired + 2 skipped', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [TEST_OLD_UIDS[0], { uid: TEST_OLD_UIDS[0], disabled: true }],
        [TEST_OLD_UIDS[1], { uid: TEST_OLD_UIDS[1], disabled: false }],
        [TEST_OLD_UIDS[2], { uid: TEST_OLD_UIDS[2], disabled: true }],
        [TEST_OLD_UIDS[3], { uid: TEST_OLD_UIDS[3], disabled: false }],
      ]),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      oldUids: TEST_OLD_UIDS,
    });

    expect(result.retired).toBe(2);
    expect(result.skippedAlreadyDisabled).toBe(2);
    expect(result.failed).toEqual([]);
    expect(fb.spies.updateUser).toHaveBeenCalledTimes(2);
  });

  it('C12: dry-run: 4 active → 4 retired (simulado), cero SDK/DB writes', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map(TEST_OLD_UIDS.map((uid) => [uid, { uid, disabled: false }])),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      oldUids: TEST_OLD_UIDS,
      dryRun: true,
    });

    expect(result.retired).toBe(4);
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
  });

  it('C13: UID inexistente → failed.not_found, batch continúa', async () => {
    const fb = makeFirebaseStub({
      existingByUid: new Map([
        [TEST_OLD_UIDS[0], { uid: TEST_OLD_UIDS[0], disabled: false }],
        [TEST_OLD_UIDS[2], { uid: TEST_OLD_UIDS[2], disabled: false }],
        // TEST_OLD_UIDS[1] y [3] no existen
      ]),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      oldUids: TEST_OLD_UIDS,
    });

    expect(result.retired).toBe(2);
    expect(result.skippedAlreadyDisabled).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(result.failed[0]?.reason).toBe('not_found');
  });

  it('C-fallback: sin oldUids en opts → usa getDemoOldUids() (env)', async () => {
    vi.stubEnv('DEMO_OLD_UIDS', TEST_OLD_UIDS.join(','));
    const fb = makeFirebaseStub({
      existingByUid: new Map(TEST_OLD_UIDS.map((uid) => [uid, { uid, disabled: false }])),
    });
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
    });

    expect(result.retired).toBe(4);
    expect(fb.spies.updateUser).toHaveBeenCalledTimes(4);
  });
});

// ===========================================================================
// Grupo D — lista vacía / ausente → no-op seguro
// ===========================================================================
describe('retireOldBatch — no-op seguro', () => {
  it('D14: oldUids: [] → {retired:0,...}, no toca SDK/DB, loguea warn', async () => {
    const warn = vi.fn();
    const logger = { ...noopLogger, warn } as unknown as Parameters<
      typeof retireOldBatch
    >[0]['logger'];
    const fb = makeFirebaseStub();
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger,
      oldUids: [],
    });

    expect(result).toEqual({ retired: 0, skippedAlreadyDisabled: 0, failed: [] });
    expect(fb.spies.getUser).not.toHaveBeenCalled();
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
    expect(dbStub.spies.update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('D14b: DEMO_OLD_UIDS ausente + sin opts.oldUids → no-op seguro', async () => {
    vi.stubEnv('DEMO_OLD_UIDS', '');
    const fb = makeFirebaseStub();
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
    });

    expect(result).toEqual({ retired: 0, skippedAlreadyDisabled: 0, failed: [] });
    expect(fb.spies.getUser).not.toHaveBeenCalled();
    expect(fb.spies.updateUser).not.toHaveBeenCalled();
  });

  it('D15: UIDs válidos pero todos not_found → failed.length === N, sin throw', async () => {
    const fb = makeFirebaseStub(); // ningún UID existe
    const dbStub = makeDbStub();

    const result = await retireOldBatch({
      db: dbStub.db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      oldUids: TEST_OLD_UIDS,
    });

    expect(result.failed).toHaveLength(TEST_OLD_UIDS.length);
    expect(result.retired).toBe(0);
    expect(result.failed.every((f) => f.reason === 'not_found')).toBe(true);
  });
});

// ===========================================================================
// Grupo E — verificación de extracción (regresión de seguridad)
// ===========================================================================
describe('regresión de seguridad: OLD_DEMO_UIDS extraído', () => {
  it('E16: OLD_DEMO_UIDS ya NO se exporta del módulo', () => {
    expect((harden as Record<string, unknown>).OLD_DEMO_UIDS).toBeUndefined();
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
