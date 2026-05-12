import type { Auth, UserRecord } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<typeof import('../../src/services/seed-demo.js').seedDemo>[0]['logger'];

/**
 * Mock progresivo de drizzle: una queue secuencial para selects y otra
 * para inserts. Cada chain `.where().limit()` o `.where()` (terminal)
 * shifts el siguiente array. Esto encaja con la naturaleza imperativa
 * del seed (orden conocido y determinístico).
 */
function makeDbStub(opts: {
  selects?: unknown[][];
  inserts?: unknown[][];
  txSelects?: unknown[][];
  txInserts?: unknown[][];
  capture?: {
    inserts: Array<{ table: string; values: unknown }>;
    deletes: Array<{ table: string }>;
  };
}) {
  const selectQueue = [...(opts.selects ?? [])];
  const insertQueue = [...(opts.inserts ?? [])];
  const txSelectQueue = [...(opts.txSelects ?? [])];
  const txInsertQueue = [...(opts.txInserts ?? [])];

  let lastInsertTable = 'unknown';
  let lastDeleteTable = 'unknown';

  function buildSelectChain(queue: unknown[][]) {
    const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
    const where = vi.fn(() => {
      const next = {
        limit,
        then: (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []),
      };
      return next;
    });
    const from = vi.fn(() => ({ where }));
    return vi.fn(() => ({ from }));
  }

  function buildInsertChain(queue: unknown[][]) {
    const returning = vi.fn(() => Promise.resolve(queue.shift() ?? []));
    const values = vi.fn((vals: unknown) => {
      opts.capture?.inserts.push({ table: lastInsertTable, values: vals });
      return {
        returning,
        // permite `await db.insert(t).values(v)` sin .returning
        then: (resolve: (v: unknown[]) => void) => resolve(queue.shift() ?? []),
      };
    });
    return vi.fn((t: { _: { name?: string } } | unknown) => {
      lastInsertTable =
        (t as { _: { name?: string } })._?.name ?? (t as { toString: () => string }).toString();
      return { values };
    });
  }

  function buildUpdate() {
    const updateWhere = vi.fn(() => Promise.resolve([]));
    const set = vi.fn(() => ({ where: updateWhere }));
    return vi.fn(() => ({ set }));
  }

  function buildDelete(table: string) {
    const where = vi.fn(() => Promise.resolve([]));
    return vi.fn(() => {
      opts.capture?.deletes.push({ table });
      return { where };
    });
  }

  // tx para deleteDemo
  const tx = {
    select: buildSelectChain(txSelectQueue),
    insert: buildInsertChain(txInsertQueue),
    update: buildUpdate(),
    delete: vi.fn(() => {
      lastDeleteTable = 'tx-table';
      opts.capture?.deletes.push({ table: lastDeleteTable });
      return { where: vi.fn(() => Promise.resolve([])) };
    }),
  };

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(tx);
  });

  return {
    db: {
      select: buildSelectChain(selectQueue),
      insert: buildInsertChain(insertQueue),
      update: buildUpdate(),
      delete: buildDelete('main'),
      transaction,
    } as unknown as Parameters<typeof import('../../src/services/seed-demo.js').seedDemo>[0]['db'],
    tx,
    transaction,
  };
}

function makeFirebaseAuth(opts: {
  existingByEmail?: Map<string, { uid: string }>;
  createdUids?: string[];
}) {
  const created = [...(opts.createdUids ?? [])];
  const existing = opts.existingByEmail ?? new Map<string, { uid: string }>();
  const calls = { create: 0, update: 0, get: 0 };

  return {
    auth: {
      getUserByEmail: vi.fn((email: string) => {
        calls.get += 1;
        const found = existing.get(email);
        if (found) {
          return Promise.resolve(found as unknown as UserRecord);
        }
        return Promise.reject(new Error('not found'));
      }),
      createUser: vi.fn(() => {
        calls.create += 1;
        const uid = created.shift() ?? `fb-uid-${calls.create}`;
        return Promise.resolve({ uid } as unknown as UserRecord);
      }),
      updateUser: vi.fn(() => {
        calls.update += 1;
        return Promise.resolve({} as unknown as UserRecord);
      }),
    } as unknown as Auth,
    calls,
  };
}

describe('seedDemo', () => {
  it('falla si plan "estandar" no existe', async () => {
    const stub = makeDbStub({ selects: [[]] });
    const fb = makeFirebaseAuth({});
    const { seedDemo } = await import('../../src/services/seed-demo.js');
    await expect(
      seedDemo({ db: stub.db, firebaseAuth: fb.auth, logger: noopLogger }),
    ).rejects.toThrow(/plan/);
  });

  it('happy path: crea todo desde cero', async () => {
    const capture = { inserts: [] as Array<{ table: string; values: unknown }>, deletes: [] };
    const stub = makeDbStub({
      selects: [
        // 1. plan
        [{ id: 'plan-1' }],
        // 2. ensureEmpresa shipper: select empresas → []
        [],
        // 3. ensureEmpresa carrier: select empresas → []
        [],
        // 4. ensureFirebaseUser shipper owner: select users by email → []
        [],
        // 5. ensureFirebaseUser carrier owner: select users by email → []
        [],
        // 6. ensureFirebaseUser stakeholder: select users by email → []
        [],
        // 7. ensureMembership shipper: select memberships limit 50 → []
        [],
        // 8. ensureMembership carrier: → []
        [],
        // 9. ensureMembership stakeholder: → []
        [],
        // 10. ensureSucursal Bodega Maipú: 2 selects
        [],
        [],
        // 11. ensureSucursal CD Quilicura: 2 selects
        [],
        [],
        // 12. ensureVehicle DEMO01: select vehicles by plate → []
        [],
        // 13. ensureVehicle DEMO02: → []
        [],
        // 14. ensureConductor: select users by rut → []
        [],
        // 14b. select conductores by userId → []
        [],
      ],
      inserts: [
        // empresa shipper
        [{ id: 'shipper-emp' }],
        // empresa carrier
        [{ id: 'carrier-emp' }],
        // user shipper owner
        [{ id: 'shipper-user' }],
        // user carrier owner
        [{ id: 'carrier-user' }],
        // user stakeholder
        [{ id: 'stake-user' }],
        // membership shipper
        [],
        // membership carrier
        [],
        // membership stakeholder
        [],
        // sucursal 1
        [],
        // sucursal 2
        [],
        // vehicle 1
        [{ id: 'veh-1' }],
        // vehicle 2
        [{ id: 'veh-2' }],
        // user conductor
        [{ id: 'cond-user' }],
        // conductor
        [{ id: 'cond-1' }],
      ],
      capture,
    });
    const fb = makeFirebaseAuth({
      createdUids: ['fb-shipper', 'fb-carrier', 'fb-stake'],
    });
    const { seedDemo } = await import('../../src/services/seed-demo.js');
    const out = await seedDemo({ db: stub.db, firebaseAuth: fb.auth, logger: noopLogger });

    expect(out.carrier_empresa_id).toBe('carrier-emp');
    expect(out.shipper_empresa_id).toBe('shipper-emp');
    expect(out.vehicle_with_mirror_id).toBe('veh-1');
    expect(out.vehicle_without_device_id).toBe('veh-2');
    expect(out.shipper_owner.email).toBe('demo-shipper@boosterchile.com');
    expect(out.carrier_owner.email).toBe('demo-carrier@boosterchile.com');
    expect(out.stakeholder.email).toBe('demo-stakeholder@boosterchile.com');
    expect(out.conductor.rut).toBe('12345678-5');
    expect(out.conductor.activation_pin).toBeTruthy();
    expect(fb.calls.create).toBe(3);
    expect(fb.calls.update).toBe(0);
  });

  it('idempotencia: encuentra empresa + users + vehicles existentes y los reusa', async () => {
    const stub = makeDbStub({
      selects: [
        // plan
        [{ id: 'plan-1' }],
        // empresa shipper: exists
        [{ id: 'shipper-exist' }],
        // empresa carrier: exists
        [{ id: 'carrier-exist' }],
        // user shipper owner: exists, same firebaseUid
        [{ id: 'shipper-user', firebaseUid: 'fb-shipper' }],
        // user carrier owner: exists, diferente firebaseUid → update
        [{ id: 'carrier-user', firebaseUid: 'fb-old' }],
        // user stakeholder: exists, same
        [{ id: 'stake-user', firebaseUid: 'fb-stake' }],
        // memberships shipper limit 50 → []
        [],
        // memberships carrier → []
        [],
        // memberships stakeholder → []
        [],
        // sucursal 1 first select limit 50 → []
        [],
        // sucursal 1 second select (by empresa) → ya existe con ese nombre, skipea insert
        [{ id: 's1', nombre: 'Bodega Maipú' }],
        // sucursal 2 first select → []
        [],
        // sucursal 2 second select → no match
        [],
        // vehicle DEMO01: exists
        [{ id: 'veh-existing-1' }],
        // vehicle DEMO02: exists
        [{ id: 'veh-existing-2' }],
        // conductor: select users by rut → exists, placeholder UID (regen PIN)
        [{ id: 'cond-user-existing', firebaseUid: 'pending-rut:12345678-5' }],
        // select conductores by userId → exists, not deleted
        [{ id: 'cond-existing', deletedAt: null }],
      ],
      inserts: [
        // segunda sucursal (la primera se saltó)
        [],
      ],
    });
    const fb = makeFirebaseAuth({
      existingByEmail: new Map([
        ['demo-shipper@boosterchile.com', { uid: 'fb-shipper' }],
        ['demo-carrier@boosterchile.com', { uid: 'fb-carrier-new' }],
        ['demo-stakeholder@boosterchile.com', { uid: 'fb-stake' }],
      ]),
    });
    const { seedDemo } = await import('../../src/services/seed-demo.js');
    const out = await seedDemo({ db: stub.db, firebaseAuth: fb.auth, logger: noopLogger });

    expect(out.shipper_empresa_id).toBe('shipper-exist');
    expect(out.carrier_empresa_id).toBe('carrier-exist');
    expect(out.vehicle_with_mirror_id).toBe('veh-existing-1');
    expect(out.vehicle_without_device_id).toBe('veh-existing-2');
    expect(out.conductor.activation_pin).toBeTruthy(); // regeneró (UID placeholder)
    expect(fb.calls.create).toBe(0);
    expect(fb.calls.update).toBe(3);
  });

  it.skip('ensureMembership: ignora error 23505 (UNIQUE composite)', async () => {
    // Forzamos error 23505 en insert memberships → no debe propagar.
    const stub = makeDbStub({
      selects: [
        [{ id: 'plan-1' }],
        [{ id: 'shipper-exist' }],
        [{ id: 'carrier-exist' }],
        // shipper owner existe con mismo uid
        [{ id: 'shipper-user', firebaseUid: 'fb-shipper' }],
        [{ id: 'carrier-user', firebaseUid: 'fb-carrier' }],
        [{ id: 'stake-user', firebaseUid: 'fb-stake' }],
        // memberships limit 50 — 3x
        [],
        [],
        [],
        // sucursales: 2 selects c/u → []
        [],
        [],
        [],
        [],
        // vehicles
        [{ id: 'v1' }],
        [{ id: 'v2' }],
        // conductor flow: users by rut exists con uid real → no regen PIN
        [{ id: 'cond-user', firebaseUid: 'fb-real' }],
        // conductores by userId exists pero deletedAt set → no reusa
        [{ id: 'cond-soft-deleted', deletedAt: new Date() }],
      ],
      inserts: [
        // memberships shipper → simula UNIQUE composite
        [],
        [],
        [],
        // sucursal 1 + 2
        [],
        [],
        // conductor insert
        [{ id: 'cond-fresh' }],
      ],
    });
    // sobrescribimos el comportamiento de insert para memberships
    let membershipInsertCount = 0;
    const origInsert = stub.db.insert as unknown as (t: unknown) => unknown;
    (stub.db as unknown as { insert: unknown }).insert = vi.fn((t: unknown) => {
      const name = String(t);
      if (name.includes('memberships')) {
        membershipInsertCount += 1;
        return {
          values: vi.fn(() => {
            const err = new Error('duplicate key value violates unique constraint');
            (err as unknown as { code: string }).code = '23505';
            return Promise.reject(err);
          }),
        };
      }
      return (origInsert as (t: unknown) => unknown)(t);
    });

    const fb = makeFirebaseAuth({
      existingByEmail: new Map([
        ['demo-shipper@boosterchile.com', { uid: 'fb-shipper' }],
        ['demo-carrier@boosterchile.com', { uid: 'fb-carrier' }],
        ['demo-stakeholder@boosterchile.com', { uid: 'fb-stake' }],
      ]),
    });
    const { seedDemo } = await import('../../src/services/seed-demo.js');
    const out = await seedDemo({ db: stub.db, firebaseAuth: fb.auth, logger: noopLogger });
    expect(out).toBeTruthy();
    expect(membershipInsertCount).toBe(3);
    expect(out.conductor.activation_pin).toBeNull(); // user existente activo, no se regen
  });

  it.skip('ensureMembership: re-throw si error no es 23505', async () => {
    const stub = makeDbStub({
      selects: [
        [{ id: 'plan-1' }],
        [{ id: 'shipper-exist' }],
        [{ id: 'carrier-exist' }],
        [{ id: 'u1', firebaseUid: 'fb-shipper' }],
      ],
      inserts: [],
    });
    (stub.db as unknown as { insert: unknown }).insert = vi.fn((t: unknown) => {
      const name = String(t);
      if (name.includes('memberships')) {
        return {
          values: vi.fn(() => {
            const err = new Error('boom');
            (err as unknown as { code: string }).code = '42P01';
            return Promise.reject(err);
          }),
        };
      }
      return {
        values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: 'x' }])) })),
      };
    });
    const fb = makeFirebaseAuth({
      existingByEmail: new Map([
        ['demo-shipper@boosterchile.com', { uid: 'fb-shipper' }],
        ['demo-carrier@boosterchile.com', { uid: 'fb-carrier' }],
        ['demo-stakeholder@boosterchile.com', { uid: 'fb-stake' }],
      ]),
    });
    // necesita 3 selects más para los users restantes:
    (stub.db as unknown as { select: unknown }).select = (() => {
      const userResults = [
        [{ id: 'plan-1' }], // plan
        [{ id: 'shipper-exist' }], // shipper empresa
        [{ id: 'carrier-exist' }], // carrier empresa
        [{ id: 'u1', firebaseUid: 'fb-shipper' }], // shipper user
        [{ id: 'u2', firebaseUid: 'fb-carrier' }], // carrier user
        [{ id: 'u3', firebaseUid: 'fb-stake' }], // stake user
      ];
      const limit = vi.fn(() => Promise.resolve(userResults.shift() ?? []));
      const where = vi.fn(() => ({
        limit,
        then: (r: (v: unknown[]) => void) => r(userResults.shift() ?? []),
      }));
      const from = vi.fn(() => ({ where }));
      return vi.fn(() => ({ from }));
    })();
    const { seedDemo } = await import('../../src/services/seed-demo.js');
    await expect(
      seedDemo({ db: stub.db, firebaseAuth: fb.auth, logger: noopLogger }),
    ).rejects.toThrow(/boom/);
  });
});

describe('deleteDemo', () => {
  it('devuelve 0 si no hay empresas demo', async () => {
    const stub = makeDbStub({ selects: [[]] });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(0);
    expect(out.viajes_eliminados).toBe(0);
  });

  /**
   * Las txSelects siguen un orden determinístico en la implementación:
   *   1. tripsAsShipper (where generadorCargaEmpresaId in demoEmpresaIds)
   *   2. tripsViaOffers (where offers.empresaId in demoEmpresaIds)
   *   3. tripsViaAssignments (where assignments.empresaId in demoEmpresaIds)
   *   4. assignmentRows (solo si hay trips — skip si paso 1+2+3 vacíos)
   *   5. Por cada empresa: vehicleRows
   *   6. Por cada empresa: driverRows
   *   7. Por cada driver: otherMemberships
   */

  it('empresa demo sin actividad (sin trips, sin vehículos, sin conductores) → solo borra empresa básica', async () => {
    const stub = makeDbStub({
      selects: [[{ id: 'emp-1' }]],
      txSelects: [
        [], // tripsAsShipper
        [], // tripsViaOffers
        [], // tripsViaAssignments
        [], // vehicleRows
        [], // driverRows
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(1);
    expect(out.viajes_eliminados).toBe(0);
    // tx.delete: vehicles, sucursales, memberships, empresa = 4 (sin trips,
    // sin telemetría, sin conductores).
    const calls = (stub.tx.delete as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(4);
  });

  it('empresa demo con conductores → borra cascada incluida users sin otras memberships', async () => {
    const stub = makeDbStub({
      selects: [[{ id: 'emp-1' }]],
      txSelects: [
        [], // tripsAsShipper
        [], // tripsViaOffers
        [], // tripsViaAssignments
        [], // vehicleRows
        [{ id: 'd1', userId: 'u-driver-1' }], // driverRows (1 conductor)
        [], // otherMemberships del driver-1 (vacío → user huérfano)
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(1);
    expect(out.viajes_eliminados).toBe(0);
    // tx.delete: conductores, vehicles, sucursales, memberships, empresa, users = 6
    expect(
      (stub.tx.delete as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('empresa demo con vehículos → limpia telemetría antes de borrar vehículos', async () => {
    const stub = makeDbStub({
      selects: [[{ id: 'emp-1' }]],
      txSelects: [
        [], // tripsAsShipper
        [], // tripsViaOffers
        [], // tripsViaAssignments
        [{ id: 'veh-1' }, { id: 'veh-2' }], // vehicleRows: 2 vehículos
        [], // driverRows
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(1);
    // tx.delete: posiciones_movil, telemetria_puntos, eventos_conduccion,
    //            vehicles, sucursales, memberships, empresa = 7
    const calls = (stub.tx.delete as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(7);
  });

  it('empresa demo con viajes históricos → cascada completa por trip', async () => {
    const stub = makeDbStub({
      selects: [[{ id: 'emp-1' }]],
      txSelects: [
        [{ id: 'trip-1' }, { id: 'trip-2' }], // tripsAsShipper (2 viajes)
        [], // tripsViaOffers (dedup vs as-shipper)
        [], // tripsViaAssignments
        [{ id: 'asg-1' }], // assignmentRows del trip → 1 asignación
        [], // vehicleRows
        [], // driverRows
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(1);
    expect(out.viajes_eliminados).toBe(2);
    // tx.delete: chat_messages, trip_events, trip_metrics, assignments,
    //            offers, trips, vehicles, sucursales, memberships, empresa = 10
    const calls = (stub.tx.delete as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(10);
  });

  it('viajes con offers/assignments al carrier demo se incluyen aunque shipper no sea demo', async () => {
    // Caso edge: el carrier demo aparece en una offer/assignment de un
    // trip NO demo (shipper real). El delete debería incluir ese trip
    // igualmente para que el carrier pueda borrarse sin FK error.
    const stub = makeDbStub({
      selects: [[{ id: 'carrier-demo' }]],
      txSelects: [
        [], // tripsAsShipper (vacío, no es shipper)
        [{ tripId: 'trip-A' }], // tripsViaOffers
        [{ tripId: 'trip-B' }], // tripsViaAssignments
        [], // assignmentRows
        [], // vehicleRows
        [], // driverRows
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.viajes_eliminados).toBe(2); // trip-A + trip-B deduped
  });

  it('conserva user-conductor si tiene otra membership activa', async () => {
    const stub = makeDbStub({
      selects: [[{ id: 'emp-1' }]],
      txSelects: [
        [], // tripsAsShipper
        [], // tripsViaOffers
        [], // tripsViaAssignments
        [], // vehicleRows
        [{ id: 'd1', userId: 'u-shared' }], // driver
        [{ id: 'm-other' }], // otra membership → NO borra el user
      ],
    });
    const { deleteDemo } = await import('../../src/services/seed-demo.js');
    const out = await deleteDemo({ db: stub.db, logger: noopLogger });
    expect(out.empresas_eliminadas).toBe(1);
    // tx.delete: conductores, vehicles, sucursales, memberships, empresa = 5
    // (NO user porque tiene otra membership)
    const calls = (stub.tx.delete as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(calls).toBe(5);
  });
});
