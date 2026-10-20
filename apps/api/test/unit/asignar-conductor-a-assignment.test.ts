import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssignmentNotFoundError,
  AssignmentNotMutableError,
  AssignmentNotOwnedError,
  DriverNotInCarrierError,
  asignarConductorAAssignment,
  condicionesConductorAsignable,
} from '../../src/services/asignar-conductor-a-assignment.js';

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

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<typeof asignarConductorAAssignment>[0]['logger'];

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000a01';
const TRIP_ID = '00000000-0000-0000-0000-000000000a02';
const EMPRESA_ID = '00000000-0000-0000-0000-000000000a03';
const ACTING_USER_ID = '00000000-0000-0000-0000-000000000a04';
const DRIVER_USER_ID = '00000000-0000-0000-0000-000000000a05';
const VEHICLE_ID = '00000000-0000-0000-0000-000000000a07';
const OTHER_VEHICLE_ID = '00000000-0000-0000-0000-000000000a08';

interface AssignmentRow {
  id: string;
  empresaId: string;
  status: string;
  driverUserId: string | null;
  tripId: string;
  vehicleId: string;
  unidadArrastreId: string | null;
}
interface DriverRow {
  userId: string;
  userFullName: string;
  conductorId: string;
  firebaseUid: string;
  email: string;
}
interface VehicleRow {
  id: string;
  empresaId: string;
  vehicleStatus: string;
  unitCategory: string;
}

/**
 * Mock progresivo del tx: 2 selects encadenados (assignment, driver),
 * 1 update y 1 insert. Patrón consistente con seed-demo.test.ts y
 * reportar-incidente.test.ts.
 */
function makeDbStub(opts: {
  assignmentRow?: AssignmentRow | null;
  driverRow?: DriverRow | null;
  vehicleRow?: VehicleRow | null;
}) {
  const selectQueue: unknown[][] = [];
  if (opts.assignmentRow !== undefined) {
    selectQueue.push(opts.assignmentRow === null ? [] : [opts.assignmentRow]);
  }
  if (opts.driverRow !== undefined) {
    selectQueue.push(opts.driverRow === null ? [] : [opts.driverRow]);
  }
  if (opts.vehicleRow !== undefined) {
    selectQueue.push(opts.vehicleRow === null ? [] : [opts.vehicleRow]);
  }

  const limitFn = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []));
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({
    where: whereFn,
    innerJoin: innerJoinFn,
  }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const updateWhereFn = vi.fn(() => Promise.resolve());
  const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
  const updateFn = vi.fn(() => ({ set: updateSetFn }));

  const insertValuesFn = vi.fn(() => Promise.resolve());
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));

  const tx = {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
  };

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx));

  return {
    db: { transaction } as unknown as Parameters<typeof asignarConductorAAssignment>[0]['db'],
    spies: {
      selectFn,
      updateFn,
      updateSetFn,
      insertFn,
      insertValuesFn,
      transaction,
    },
  };
}

const baseAssignment = (overrides: Partial<AssignmentRow> = {}): AssignmentRow => ({
  id: ASSIGNMENT_ID,
  empresaId: EMPRESA_ID,
  status: 'asignado',
  driverUserId: null,
  tripId: TRIP_ID,
  vehicleId: VEHICLE_ID,
  unidadArrastreId: null,
  ...overrides,
});

const baseDriver = (overrides: Partial<DriverRow> = {}): DriverRow => ({
  userId: DRIVER_USER_ID,
  userFullName: 'Pedro González (Demo)',
  conductorId: '00000000-0000-0000-0000-000000000a06',
  firebaseUid: 'firebase-real',
  email: 'conductor@example.com',
  ...overrides,
});

const baseVehicle = (overrides: Partial<VehicleRow> = {}): VehicleRow => ({
  id: OTHER_VEHICLE_ID,
  empresaId: EMPRESA_ID,
  vehicleStatus: 'activo',
  unitCategory: 'motriz',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('asignarConductorAAssignment', () => {
  it('happy path: asigna el conductor a un assignment sin driver previo', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
    });
    const result = await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
    });
    expect(result.assignmentId).toBe(ASSIGNMENT_ID);
    expect(result.previousDriverUserId).toBeNull();
    expect(result.newDriverUserId).toBe(DRIVER_USER_ID);
    expect(result.driverName).toBe('Pedro González (Demo)');
    expect(stub.spies.updateFn).toHaveBeenCalled();
    expect(stub.spies.insertFn).toHaveBeenCalled(); // audit event
  });

  it('reasignación: permite cambiar el conductor si el assignment está en estado asignado', async () => {
    const previousDriverId = '00000000-0000-0000-0000-0000000000ff';
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ driverUserId: previousDriverId }),
      driverRow: baseDriver(),
    });
    const result = await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
    });
    expect(result.previousDriverUserId).toBe(previousDriverId);
    expect(result.newDriverUserId).toBe(DRIVER_USER_ID);
  });

  it('estado recogido: permite reasignación mid-trip (caso relevo de chofer)', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ status: 'recogido' }),
      driverRow: baseDriver(),
    });
    const result = await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
    });
    expect(result.newDriverUserId).toBe(DRIVER_USER_ID);
  });

  it('AssignmentNotFoundError: assignment no existe', async () => {
    const stub = makeDbStub({ assignmentRow: null });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
      }),
    ).rejects.toThrow(AssignmentNotFoundError);
  });

  it('AssignmentNotOwnedError: assignment pertenece a OTRO carrier', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ empresaId: 'otra-empresa-id' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
      }),
    ).rejects.toThrow(AssignmentNotOwnedError);
  });

  it('AssignmentNotMutableError: assignment está entregado (terminal)', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ status: 'entregado' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
      }),
    ).rejects.toThrow(AssignmentNotMutableError);
  });

  it('AssignmentNotMutableError: assignment está cancelado', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ status: 'cancelado' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
      }),
    ).rejects.toThrow(AssignmentNotMutableError);
  });

  it('DriverNotInCarrierError: el driver no es conductor activo del carrier', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: null,
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
      }),
    ).rejects.toThrow(DriverNotInCarrierError);
  });

  it('audit event: registra trip_events con previous/new driver + acting user', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
    });
    await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
    });
    expect(stub.spies.insertValuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: TRIP_ID,
        eventType: 'conductor_asignado',
        source: 'web',
        payload: expect.objectContaining({
          assignment_id: ASSIGNMENT_ID,
          previous_driver_user_id: null,
          new_driver_user_id: DRIVER_USER_ID,
          driver_name: 'Pedro González (Demo)',
          acting_user_id: ACTING_USER_ID,
        }),
      }),
    );
  });

  it('conductor pendiente de activación (RUT 11.111.111-1) se asigna y queda marcado', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver({
        firebaseUid: 'pending-rut:11111111-1',
        email: 'pendiente@example.com',
      }),
    });
    const result = await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
    });
    expect(result.newDriverUserId).toBe(DRIVER_USER_ID);
    expect(result.driverPending).toBe(true);
  });

  it('vehiculo_id de la flota motriz activa reemplaza el camión del assignment', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
      vehicleRow: baseVehicle(),
    });
    const result = await asignarConductorAAssignment({
      db: stub.db,
      logger: noopLogger,
      assignmentId: ASSIGNMENT_ID,
      driverUserId: DRIVER_USER_ID,
      empresaId: EMPRESA_ID,
      actingUserId: ACTING_USER_ID,
      vehiculoId: OTHER_VEHICLE_ID,
    });
    expect(result.previousVehicleId).toBe(VEHICLE_ID);
    expect(result.newVehicleId).toBe(OTHER_VEHICLE_ID);
    expect(stub.spies.updateSetFn).toHaveBeenCalledWith(
      expect.objectContaining({
        driverUserId: DRIVER_USER_ID,
        vehicleId: OTHER_VEHICLE_ID,
      }),
    );
  });

  it('vehiculo de otra empresa → no se asigna', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
      vehicleRow: baseVehicle({ empresaId: 'otra-empresa' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
        vehiculoId: OTHER_VEHICLE_ID,
      }),
    ).rejects.toThrow(/not_in_fleet/);
  });

  it('vehiculo retirado o de arrastre → no se asigna', async () => {
    const retirado = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
      vehicleRow: baseVehicle({ vehicleStatus: 'retirado' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: retirado.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
        vehiculoId: OTHER_VEHICLE_ID,
      }),
    ).rejects.toThrow(/not_active/);

    const arrastre = makeDbStub({
      assignmentRow: baseAssignment(),
      driverRow: baseDriver(),
      vehicleRow: baseVehicle({ unitCategory: 'arrastre' }),
    });
    await expect(
      asignarConductorAAssignment({
        db: arrastre.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
        vehiculoId: OTHER_VEHICLE_ID,
      }),
    ).rejects.toThrow(/not_motriz/);
  });

  it('el camión no puede ser la unidad de arrastre de la misma asignación', async () => {
    const stub = makeDbStub({
      assignmentRow: baseAssignment({ unidadArrastreId: OTHER_VEHICLE_ID }),
      driverRow: baseDriver(),
      vehicleRow: baseVehicle(),
    });
    await expect(
      asignarConductorAAssignment({
        db: stub.db,
        logger: noopLogger,
        assignmentId: ASSIGNMENT_ID,
        driverUserId: DRIVER_USER_ID,
        empresaId: EMPRESA_ID,
        actingUserId: ACTING_USER_ID,
        vehiculoId: OTHER_VEHICLE_ID,
      }),
    ).rejects.toThrow(/es_el_arrastre/);
  });

  it('el filtro del conductor no mira firebase_uid ni la activación', () => {
    const nombres = nombresDeColumna(condicionesConductorAsignable(EMPRESA_ID, DRIVER_USER_ID));
    expect(nombres).toEqual(expect.arrayContaining(['usuario_id', 'empresa_id', 'eliminado_en']));
    expect(nombres).not.toContain('firebase_uid');
  });
});

function nombresDeColumna(value: unknown, seen = new Set<unknown>()): string[] {
  if (value == null || typeof value !== 'object') {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  if (typeof rec.name === 'string') {
    out.push(rec.name);
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === 'object') {
      out.push(...nombresDeColumna(child, seen));
    }
  }
  return out;
}
