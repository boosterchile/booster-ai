import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistGreenDrivingFromRecord } from '../src/persist-green-driving.js';
import type { RecordMessage } from '../src/persist.js';

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

interface DbStub {
  execute: ReturnType<typeof vi.fn>;
}

function makeDb(returns: Array<{ rows: unknown[] }>): DbStub {
  const execute = vi.fn();
  for (const r of returns) {
    execute.mockResolvedValueOnce(r);
  }
  return { execute };
}

const VALID_MSG_BASE: RecordMessage = {
  imei: '356307042441013',
  vehicleId: '11111111-2222-3333-4444-555555555555',
  record: {
    timestampMs: '1700000000000',
    priority: 1,
    gps: {
      longitude: -70.65,
      latitude: -33.45,
      altitude: 540,
      angle: 180,
      satellites: 12,
      speedKmh: 85,
    },
    io: {
      eventIoId: 253,
      totalIo: 1,
      entries: [{ id: 253, value: 1, byteSize: 1 }],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('persistGreenDrivingFromRecord — early returns', () => {
  it('vehicleId null → 0/0 sin tocar DB', async () => {
    const db = makeDb([]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: { ...VALID_MSG_BASE, vehicleId: null },
    });
    expect(result).toEqual({ extractedCount: 0, insertedCount: 0 });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('record sin IO de green-driving → 0/0 sin INSERT', async () => {
    const db = makeDb([]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: {
        ...VALID_MSG_BASE,
        record: {
          ...VALID_MSG_BASE.record,
          io: {
            eventIoId: 0,
            totalIo: 1,
            entries: [{ id: 240, value: 1, byteSize: 1 }],
          },
        },
      },
    });
    expect(result).toEqual({ extractedCount: 0, insertedCount: 0 });
    expect(db.execute).not.toHaveBeenCalled();
  });
});

describe('persistGreenDrivingFromRecord — happy path', () => {
  it('event harsh_acceleration extraído + insertado → 1/1', async () => {
    const db = makeDb([{ rows: [{ id: 'evt-uuid' }] }]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG_BASE,
    });
    expect(result.extractedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(noopLogger.info).toHaveBeenCalled();
  });

  it('ON CONFLICT (rows vacío) → extraído 1, insertado 0, sin log', async () => {
    const db = makeDb([{ rows: [] }]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG_BASE,
    });
    expect(result.extractedCount).toBe(1);
    expect(result.insertedCount).toBe(0);
    expect(noopLogger.info).not.toHaveBeenCalled();
  });

  it('over_speed event (id 255) → mapeo a exceso_velocidad', async () => {
    const db = makeDb([{ rows: [{ id: 'evt-2' }] }]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: {
        ...VALID_MSG_BASE,
        record: {
          ...VALID_MSG_BASE.record,
          io: {
            eventIoId: 255,
            totalIo: 1,
            entries: [{ id: 255, value: 95, byteSize: 1 }],
          },
        },
      },
    });
    expect(result.extractedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
  });

  it('IO entry value como string → se convierte a number', async () => {
    const db = makeDb([{ rows: [{ id: 'evt-3' }] }]);
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: {
        ...VALID_MSG_BASE,
        record: {
          ...VALID_MSG_BASE.record,
          io: {
            eventIoId: 253,
            totalIo: 1,
            entries: [{ id: 253, value: '2', byteSize: 1 }],
          },
        },
      },
    });
    expect(result.extractedCount).toBe(1);
    expect(result.insertedCount).toBe(1);
  });

  it('rows undefined en result → trata como 0 inserts', async () => {
    const db = { execute: vi.fn().mockResolvedValueOnce({ rows: undefined }) };
    const result = await persistGreenDrivingFromRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG_BASE,
    });
    expect(result.insertedCount).toBe(0);
  });
});
