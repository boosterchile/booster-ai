import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmarEntregaViaje } from '../../src/services/confirmar-entrega-viaje.js';

// Mock emitirCertificadoViaje porque es fire-and-forget post-commit y
// requiere KMS+GCS. Aquí solo probamos el flujo de confirmar.
vi.mock('../../src/services/emitir-certificado-viaje.js', () => ({
  emitirCertificadoViaje: vi.fn(async () => ({
    skipped: false,
    pdfSha256: 'abc',
    kmsKeyVersion: '1',
  })),
}));

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  updates?: unknown[][];
  inserts?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];
  const inserts = [...(queues.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildUpdateChain = () => {
    const chain: Record<string, unknown> = {
      set: vi.fn(() => chain),
      where: vi.fn(async () => updates.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(async () => inserts.shift() ?? []),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
    insert: vi.fn(() => buildInsertChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    select: tx.select,
    update: tx.update,
    insert: tx.insert,
  };
}

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const SHIPPER_EMP_ID = 'shipper-emp';
const CARRIER_EMP_ID = 'carrier-emp';
const USER_ID = 'user-uuid';
const ASSIGNMENT_ID = 'assign-uuid';

const TRIP_BASE = {
  id: TRIP_ID,
  status: 'asignado',
  generadorCargaEmpresaId: SHIPPER_EMP_ID,
};

const ASSIGNMENT_BASE = {
  id: ASSIGNMENT_ID,
  empresaId: CARRIER_EMP_ID,
  deliveredAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('confirmarEntregaViaje', () => {
  it('trip no existe → ok=false code=trip_not_found', async () => {
    const db = makeDb({ selects: [[]] });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: false, code: 'trip_not_found' });
  });

  it('shipper que NO es owner del trip → forbidden_owner_mismatch', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, generadorCargaEmpresaId: 'OTRO-shipper' }], [ASSIGNMENT_BASE]],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: false, code: 'forbidden_owner_mismatch' });
  });

  it('carrier sin assignment → no_assignment', async () => {
    const db = makeDb({
      selects: [[TRIP_BASE], []], // assignment vacío
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'carrier',
      actor: { empresaId: CARRIER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: false, code: 'no_assignment' });
  });

  it('carrier que NO es owner del assignment → forbidden_owner_mismatch', async () => {
    const db = makeDb({
      selects: [[TRIP_BASE], [{ ...ASSIGNMENT_BASE, empresaId: 'OTRO-carrier' }]],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'carrier',
      actor: { empresaId: CARRIER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: false, code: 'forbidden_owner_mismatch' });
  });

  it('idempotente: trip ya entregado → ok=true alreadyDelivered=true', async () => {
    const past = new Date('2026-04-01T00:00:00Z');
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, status: 'entregado' }],
        [{ ...ASSIGNMENT_BASE, deliveredAt: past }],
      ],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: true, alreadyDelivered: true, deliveredAt: past });
  });

  it('idempotente sin assignment.deliveredAt → fallback a now()', async () => {
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, status: 'entregado' }],
        [{ ...ASSIGNMENT_BASE, deliveredAt: null }],
      ],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    if (!result.ok || !result.alreadyDelivered) {
      throw new Error('expected alreadyDelivered=true');
    }
    expect(result.deliveredAt).toBeInstanceOf(Date);
  });

  it('status del trip no confirmable (cancelado) → invalid_status', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, status: 'cancelado' }], [ASSIGNMENT_BASE]],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({
      ok: false,
      code: 'invalid_status',
      currentStatus: 'cancelado',
    });
  });

  it('shipper happy path: status asignado → entregado, UPDATEs + audit', async () => {
    const db = makeDb({
      selects: [[TRIP_BASE], [ASSIGNMENT_BASE]],
      updates: [[], []], // UPDATE trip + UPDATE assignment
      inserts: [[]], // INSERT tripEvent
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    if (!result.ok) {
      throw new Error('expected ok=true');
    }
    expect(result.alreadyDelivered).toBe(false);
    expect(result.deliveredAt).toBeInstanceOf(Date);
  });

  it('carrier happy path: status en_proceso → entregado', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, status: 'en_proceso' }], [ASSIGNMENT_BASE]],
      updates: [[], []],
      inserts: [[]],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'carrier',
      actor: { empresaId: CARRIER_EMP_ID, userId: USER_ID },
      config: {},
    });
    if (!result.ok) {
      throw new Error('expected ok=true');
    }
    expect(result.alreadyDelivered).toBe(false);
  });

  it('shipper sin assignment + status confirmable → no_assignment', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE], // trip status=asignado
        [], // sin assignment (edge case: row borrado)
      ],
    });
    const result = await confirmarEntregaViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      source: 'shipper',
      actor: { empresaId: SHIPPER_EMP_ID, userId: USER_ID },
      config: {},
    });
    expect(result).toEqual({ ok: false, code: 'no_assignment' });
  });
});
