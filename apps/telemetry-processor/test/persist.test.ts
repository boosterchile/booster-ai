import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RecordMessage, persistRecord, recordMessageSchema } from '../src/persist.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: vi.fn(),
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

const VALID_MSG: RecordMessage = {
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
      eventIoId: 0,
      totalIo: 2,
      entries: [
        { id: 240, value: 1, byteSize: 1 },
        { id: 256, value: '12.5', byteSize: 4 },
      ],
    },
  },
};

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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('recordMessageSchema', () => {
  it('valida un mensaje correcto', () => {
    expect(recordMessageSchema.safeParse(VALID_MSG).success).toBe(true);
  });

  it('rechaza imei muy corto', () => {
    const bad = { ...VALID_MSG, imei: '123' };
    expect(recordMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('rechaza vehicleId no-uuid (cuando no es null)', () => {
    const bad = { ...VALID_MSG, vehicleId: 'not-uuid' };
    expect(recordMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('acepta vehicleId null', () => {
    const ok = { ...VALID_MSG, vehicleId: null };
    expect(recordMessageSchema.safeParse(ok).success).toBe(true);
  });

  it('rechaza priority fuera de [0,1,2]', () => {
    const bad = {
      ...VALID_MSG,
      record: { ...VALID_MSG.record, priority: 5 as never },
    };
    expect(recordMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe('persistRecord', () => {
  it('vehicleId null → skip insert, retorna inserted=false', async () => {
    const db = makeDb([]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: { ...VALID_MSG, vehicleId: null },
    });
    expect(result).toEqual({ inserted: false, isFirstPointForVehicle: false });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('insert exitoso con primer punto del vehículo retorna isFirstPointForVehicle=true', async () => {
    const db = makeDb([
      { rows: [{ id: 'punto-uuid-1' }] }, // INSERT returning
      { rows: [{ count: '1' }] }, // SELECT count
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: true });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('insert exitoso pero NO primer punto → isFirstPointForVehicle=false', async () => {
    const db = makeDb([{ rows: [{ id: 'punto-uuid-2' }] }, { rows: [{ count: '500' }] }]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: false });
  });

  it('duplicado (RETURNING vacío) → inserted=false, no consulta count', async () => {
    const db = makeDb([{ rows: [] }]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: false, isFirstPointForVehicle: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('count count=0 (raro/inconsistente) → isFirstPointForVehicle=false', async () => {
    const db = makeDb([
      { rows: [{ id: 'punto' }] },
      { rows: [{ count: '0' }] }, // raro pero defensivo
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: false });
  });
});
