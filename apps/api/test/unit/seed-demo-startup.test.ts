import type { Auth } from 'firebase-admin/auth';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del startup hook `ensureDemoSeeded` (modo demo subdominio).
 *
 * Comportamiento esperado:
 *   - Flag DEMO_MODE_ACTIVATED=false → no-op, no llama seedDemo ni DB.
 *   - Flag ON + empresa shipper demo existe → skip seedDemo, igual
 *     intenta promover conductor (idempotente).
 *   - Flag ON + no existe → llama a seedDemo + promueve conductor.
 *   - Errores no propagan (no matan startup).
 */

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

beforeEach(() => {
  vi.resetModules();
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/services/seed-demo-startup.js').ensureDemoSeeded
>[0]['logger'];

/**
 * DB stub:
 *   - El primer select() → query "empresa shipper demo existe?".
 *     Devuelve `shipperRows` (cualquier shape).
 *   - El segundo select() → query "conductor demo + user" (innerJoin).
 *     Devuelve `conductorRows`.
 *   - Update encadenado `db.update().set().where()` siempre OK.
 *
 * Las queries reales se distinguen por estructura (.where().limit() vs
 * .innerJoin().where().limit()); el stub no las diferencia — emite
 * los rows del queue en orden de llamada a select().
 */
function makeDbStub(opts: {
  shipperRows: Array<Record<string, unknown>>;
  conductorRows?: Array<Record<string, unknown>>;
}) {
  const limitQueue: Array<Array<Record<string, unknown>>> = [
    opts.shipperRows,
    opts.conductorRows ?? [],
  ];

  const updateWhereSpy = vi.fn(() => Promise.resolve(undefined));
  const set = vi.fn(() => ({ where: updateWhereSpy }));
  const update = vi.fn(() => ({ set }));

  const selectSpy = vi.fn(() => {
    const rows = limitQueue.shift() ?? [];
    const limit = vi.fn(() => Promise.resolve(rows));
    const where = vi.fn(() => ({ limit }));
    const innerJoin: ReturnType<typeof vi.fn> = vi.fn(() => ({
      innerJoin,
      where,
    }));
    const from = vi.fn(() => ({ where, innerJoin }));
    return { from };
  });

  return {
    db: { select: selectSpy, update } as unknown as Parameters<
      typeof import('../../src/services/seed-demo-startup.js').ensureDemoSeeded
    >[0]['db'],
    spies: { select: selectSpy, update, updateWhere: updateWhereSpy },
  };
}

function makeFirebaseStub(opts: { existingFbUser?: boolean } = {}) {
  const createCustomToken = vi.fn().mockResolvedValue('token');
  const getUserByEmail = opts.existingFbUser
    ? vi.fn().mockResolvedValue({ uid: 'fb-existing' })
    : vi.fn().mockRejectedValue(new Error('not-found'));
  const createUser = vi.fn().mockResolvedValue({ uid: 'fb-new' });
  const updateUser = vi.fn().mockResolvedValue({ uid: 'fb-existing' });
  return {
    auth: {
      createCustomToken,
      getUserByEmail,
      createUser,
      updateUser,
    } as unknown as Auth,
    spies: { createCustomToken, getUserByEmail, createUser, updateUser },
  };
}

describe('ensureDemoSeeded', () => {
  it('flag DEMO_MODE_ACTIVATED=false → no-op (no toca DB ni seedDemo)', async () => {
    const seedDemoSpy = vi.fn();
    vi.doMock('../../src/services/seed-demo.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/seed-demo.js')>(
        '../../src/services/seed-demo.js',
      );
      return { ...actual, seedDemo: seedDemoSpy };
    });

    const { ensureDemoSeeded } = await import('../../src/services/seed-demo-startup.js');
    const { db, spies } = makeDbStub({ shipperRows: [] });
    const fb = makeFirebaseStub();
    await ensureDemoSeeded({
      db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      config: { DEMO_MODE_ACTIVATED: false },
    });

    expect(seedDemoSpy).not.toHaveBeenCalled();
    expect(spies.select).not.toHaveBeenCalled();
  });

  it('flag ON + shipper demo ya existe → skip seedDemo, sí intenta promover conductor', async () => {
    const seedDemoSpy = vi.fn().mockResolvedValue({});
    vi.doMock('../../src/services/seed-demo.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/seed-demo.js')>(
        '../../src/services/seed-demo.js',
      );
      return { ...actual, seedDemo: seedDemoSpy };
    });

    const { ensureDemoSeeded } = await import('../../src/services/seed-demo-startup.js');
    // 1ª select: shipper existe (1 row). 2ª select: conductor ya promovido
    // (firebase_uid real), por lo que ensureConductorDemoActivated es no-op.
    const { db, spies } = makeDbStub({
      shipperRows: [{ id: 'empresa-shipper-demo-1' }],
      conductorRows: [{ userId: 'u-driver-1', firebaseUid: 'fb-real-already', email: 'x@y' }],
    });
    const fb = makeFirebaseStub();
    await ensureDemoSeeded({
      db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      config: { DEMO_MODE_ACTIVATED: true, DEMO_SEED_PASSWORD: 'test-seed-password-1234' },
    });

    expect(seedDemoSpy).not.toHaveBeenCalled();
    // 1 select para shipper, 1 select para conductor (idempotente check).
    expect(spies.select).toHaveBeenCalledTimes(2);
    // No update porque el conductor ya tiene firebase_uid real.
    expect(spies.update).not.toHaveBeenCalled();
  });

  it('flag ON + no seedeado → llama a seedDemo y luego promueve conductor', async () => {
    const seedDemoSpy = vi.fn().mockResolvedValue({
      shipper_owner: { email: 'demo-shipper@boosterchile.com', password: 'X' },
      carrier_owner: { email: 'demo-carrier@boosterchile.com', password: 'X' },
      stakeholder: { email: 'demo-stakeholder@boosterchile.com', password: 'X' },
      conductor: { rut: '12345678-5', activation_pin: '123456' },
      carrier_empresa_id: 'e1',
      shipper_empresa_id: 'e2',
      vehicle_with_mirror_id: 'v1',
      vehicle_without_device_id: 'v2',
    });
    vi.doMock('../../src/services/seed-demo.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/seed-demo.js')>(
        '../../src/services/seed-demo.js',
      );
      return { ...actual, seedDemo: seedDemoSpy };
    });

    const { ensureDemoSeeded } = await import('../../src/services/seed-demo-startup.js');
    // 1ª select: shipper NO existe. 2ª select (post-seed): conductor con
    // firebase_uid placeholder (necesita promoción).
    const { db, spies } = makeDbStub({
      shipperRows: [],
      conductorRows: [{ userId: 'u-driver-1', firebaseUid: 'pending-rut:123456785', email: 'x@y' }],
    });
    const fb = makeFirebaseStub();
    await ensureDemoSeeded({
      db,
      firebaseAuth: fb.auth,
      logger: noopLogger,
      config: { DEMO_MODE_ACTIVATED: true, DEMO_SEED_PASSWORD: 'test-seed-password-1234' },
    });

    expect(seedDemoSpy).toHaveBeenCalledTimes(1);
    // Firebase user creado (no existía).
    expect(fb.spies.createUser).toHaveBeenCalled();
    // DB update para sincronizar el firebase_uid del conductor.
    expect(spies.update).toHaveBeenCalled();
  });

  it('flag ON + seedDemo lanza → captura, no propaga', async () => {
    const seedDemoSpy = vi.fn().mockRejectedValue(new Error('postgres pum'));
    vi.doMock('../../src/services/seed-demo.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/seed-demo.js')>(
        '../../src/services/seed-demo.js',
      );
      return { ...actual, seedDemo: seedDemoSpy };
    });

    const { ensureDemoSeeded } = await import('../../src/services/seed-demo-startup.js');
    const { db } = makeDbStub({ shipperRows: [] });
    const fb = makeFirebaseStub();

    // El test pasa si NO se lanza una exception (no propaga).
    await expect(
      ensureDemoSeeded({
        db,
        firebaseAuth: fb.auth,
        logger: noopLogger,
        config: { DEMO_MODE_ACTIVATED: true, DEMO_SEED_PASSWORD: 'test-seed-password-1234' },
      }),
    ).resolves.toBeUndefined();
    expect(seedDemoSpy).toHaveBeenCalled();
  });
});
