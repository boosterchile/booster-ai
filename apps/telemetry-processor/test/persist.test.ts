import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RecordMessage, persistRecord, recordMessageSchema } from '../src/persist.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
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
  it('vehicleId null + IMEI no registrado → lookup, descarta con warn, sin INSERT', async () => {
    const db = makeDb([
      { rows: [] }, // SELECT vehiculos por IMEI: sin match
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: { ...VALID_MSG, vehicleId: null },
    });
    expect(result).toEqual({ inserted: false, isFirstPointForVehicle: false });
    // Solo el lookup; ningún INSERT.
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect((noopLogger as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
  });

  it('vehicleId null + IMEI registrado → resuelve y persiste (caso sms-fallback)', async () => {
    const resolvedId = '99999999-8888-7777-6666-555555555555';
    const db = makeDb([
      { rows: [{ id: resolvedId }] }, // SELECT vehiculos por IMEI: match
      { rows: [{ id: 'punto-uuid-9' }] }, // INSERT returning
      { rows: [{ ok: 1 }, { ok: 1 }] }, // first-check: 2 filas → no es primero
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: { ...VALID_MSG, vehicleId: null },
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: false });
    expect(db.execute).toHaveBeenCalledTimes(3);
  });

  it('vehicleId presente → cero lookups extra (2 executes: insert + first-check)', async () => {
    const db = makeDb([
      { rows: [{ id: 'punto-uuid-1' }] }, // INSERT returning
      { rows: [{ ok: 1 }] }, // first-check: 1 fila → primero
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: true });
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('insert exitoso pero NO primer punto (LIMIT 2 retorna 2 filas) → false', async () => {
    const db = makeDb([{ rows: [{ id: 'punto-uuid-2' }] }, { rows: [{ ok: 1 }, { ok: 1 }] }]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: false });
  });

  it('duplicado (RETURNING vacío) → inserted=false, no consulta first-check', async () => {
    const db = makeDb([{ rows: [] }]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: false, isFirstPointForVehicle: false });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('first-check 0 filas (raro/inconsistente) → isFirstPointForVehicle=false', async () => {
    const db = makeDb([
      { rows: [{ id: 'punto' }] },
      { rows: [] }, // raro pero defensivo
    ]);
    const result = await persistRecord({
      db: db as never,
      logger: noopLogger,
      msg: VALID_MSG,
    });
    expect(result).toEqual({ inserted: true, isFirstPointForVehicle: false });
  });
});
