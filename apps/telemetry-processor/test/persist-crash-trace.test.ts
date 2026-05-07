import type { CrashTrace } from '@booster-ai/codec8-parser';
import { describe, expect, it, vi } from 'vitest';
import {
  type CrashTraceIndexer,
  type CrashTraceUploader,
  bigintReplacer,
  crashTraceMessageSchema,
  persistCrashTrace,
} from '../src/persist-crash-trace.js';

// biome-ignore lint/suspicious/noExplicitAny: minimal logger mock for tests
const noopLogger: any = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

function makeMockUploader(): CrashTraceUploader & {
  calls: Array<{ bucketName: string; objectPath: string; jsonContent: string }>;
} {
  const calls: Array<{ bucketName: string; objectPath: string; jsonContent: string }> = [];
  return {
    calls,
    async upload(opts) {
      calls.push(opts);
    },
  };
}

function makeMockIndexer(): CrashTraceIndexer & {
  calls: Array<{ datasetId: string; tableId: string; row: Record<string, unknown> }>;
} {
  const calls: Array<{ datasetId: string; tableId: string; row: Record<string, unknown> }> = [];
  return {
    calls,
    async insertRow(opts) {
      calls.push(opts as { datasetId: string; tableId: string; row: Record<string, unknown> });
    },
  };
}

function makeTrace(overrides: Partial<CrashTrace> = {}): CrashTrace {
  return {
    crashTimestampMs: 1700000005000n,
    peakGForce: 4.5,
    durationMs: 10000,
    accelerometer: [
      { tMsOffset: -10, xMg: 100, yMg: 0, zMg: 980 },
      { tMsOffset: 0, xMg: 3000, yMg: -2500, zMg: 1500 },
    ],
    gnss: [
      {
        tMsOffset: 0,
        longitude: -70.6483,
        latitude: -33.4569,
        altitude: 567,
        speedKmh: 80,
        angle: 137,
        satellites: 12,
      },
    ],
    io: [{ tMsOffset: 0, entries: [{ id: 239, value: 1, byteSize: 1 }] }],
    ...overrides,
  };
}

describe('persistCrashTrace — Wave 2 Track B3', () => {
  it('sube el trace a GCS bajo {vehicleId}/{timestamp}.json', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    const result = await persistCrashTrace({
      trace: makeTrace(),
      vehicleId: 'veh-uuid-123',
      imei: '356307042441013',
      uploader,
      indexer,
      bucketName: 'booster-crash-traces-prod',
      bigQueryDatasetId: 'telemetry',
      bigQueryTableId: 'crash_events',
      logger: noopLogger,
    });

    expect(uploader.calls).toHaveLength(1);
    const call = uploader.calls[0];
    expect(call?.bucketName).toBe('booster-crash-traces-prod');
    expect(call?.objectPath).toMatch(/^veh-uuid-123\/2023-11-14T22-13-25-000Z\.json$/);
    expect(result.gcsPath).toBe(`gs://booster-crash-traces-prod/${call?.objectPath}`);
  });

  it('cuando vehicleId es null, usa path unassigned/{imei}/...', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    await persistCrashTrace({
      trace: makeTrace(),
      vehicleId: null,
      imei: '356307042441013',
      uploader,
      indexer,
      bucketName: 'booster-crash-traces-prod',
      bigQueryDatasetId: 'telemetry',
      bigQueryTableId: 'crash_events',
      logger: noopLogger,
    });

    const call = uploader.calls[0];
    expect(call?.objectPath).toMatch(/^unassigned\/356307042441013\//);
  });

  it('inserta una fila en BigQuery con todos los campos del schema', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    const trace = makeTrace({ peakGForce: 6.7, durationMs: 9876 });
    const result = await persistCrashTrace({
      trace,
      vehicleId: 'veh-uuid-456',
      imei: '999888777666555',
      uploader,
      indexer,
      bucketName: 'booster-crash-traces-prod',
      bigQueryDatasetId: 'telemetry',
      bigQueryTableId: 'crash_events',
      logger: noopLogger,
    });

    expect(indexer.calls).toHaveLength(1);
    const call = indexer.calls[0];
    expect(call?.datasetId).toBe('telemetry');
    expect(call?.tableId).toBe('crash_events');
    expect(call?.row).toMatchObject({
      crash_id: result.crashId,
      vehicle_id: 'veh-uuid-456',
      imei: '999888777666555',
      timestamp: '2023-11-14T22:13:25.000Z',
      gcs_path: result.gcsPath,
      peak_g_force: 6.7,
      duration_ms: 9876,
    });
  });

  it('row.vehicle_id = null cuando vehicleId es null', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    await persistCrashTrace({
      trace: makeTrace(),
      vehicleId: null,
      imei: '356307042441013',
      uploader,
      indexer,
      bucketName: 'booster-crash-traces-prod',
      bigQueryDatasetId: 'telemetry',
      bigQueryTableId: 'crash_events',
      logger: noopLogger,
    });
    expect(indexer.calls[0]?.row.vehicle_id).toBeNull();
  });

  it('genera crash_id UUID v4 distinto por invocación', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    const r1 = await persistCrashTrace({
      trace: makeTrace(),
      vehicleId: 'veh-1',
      imei: '111',
      uploader,
      indexer,
      bucketName: 'b',
      bigQueryDatasetId: 'd',
      bigQueryTableId: 't',
      logger: noopLogger,
    });
    const r2 = await persistCrashTrace({
      trace: makeTrace(),
      vehicleId: 'veh-1',
      imei: '111',
      uploader,
      indexer,
      bucketName: 'b',
      bigQueryDatasetId: 'd',
      bigQueryTableId: 't',
      logger: noopLogger,
    });
    expect(r1.crashId).not.toBe(r2.crashId);
    expect(r1.crashId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('JSON serializa BigInt como string (replacer)', async () => {
    const uploader = makeMockUploader();
    const indexer = makeMockIndexer();
    const trace = makeTrace({ crashTimestampMs: 1700000005000n });
    await persistCrashTrace({
      trace,
      vehicleId: 'veh-1',
      imei: '111',
      uploader,
      indexer,
      bucketName: 'b',
      bigQueryDatasetId: 'd',
      bigQueryTableId: 't',
      logger: noopLogger,
    });
    const json = uploader.calls[0]?.jsonContent ?? '';
    const parsed = JSON.parse(json) as { crashTimestampMs: string };
    expect(parsed.crashTimestampMs).toBe('1700000005000');
    expect(typeof parsed.crashTimestampMs).toBe('string');
  });

  it('upload error aborta antes del insert (no insert con upload fallido)', async () => {
    const uploader: CrashTraceUploader = {
      async upload() {
        throw new Error('GCS network error');
      },
    };
    const indexer = makeMockIndexer();
    await expect(
      persistCrashTrace({
        trace: makeTrace(),
        vehicleId: 'veh-1',
        imei: '111',
        uploader,
        indexer,
        bucketName: 'b',
        bigQueryDatasetId: 'd',
        bigQueryTableId: 't',
        logger: noopLogger,
      }),
    ).rejects.toThrow('GCS network error');
    expect(indexer.calls).toHaveLength(0);
  });

  it('insert error propaga (Pub/Sub debe NACK para reintentar)', async () => {
    const uploader = makeMockUploader();
    const indexer: CrashTraceIndexer = {
      async insertRow() {
        throw new Error('BigQuery quota exceeded');
      },
    };
    await expect(
      persistCrashTrace({
        trace: makeTrace(),
        vehicleId: 'veh-1',
        imei: '111',
        uploader,
        indexer,
        bucketName: 'b',
        bigQueryDatasetId: 'd',
        bigQueryTableId: 't',
        logger: noopLogger,
      }),
    ).rejects.toThrow('BigQuery quota exceeded');
    // El upload sí pasó: el GCS object queda y el reintentenel insert
    // intenta de nuevo. Idempotencia: BigQuery insertId previene
    // duplicados en reinserción.
    expect(uploader.calls).toHaveLength(1);
  });
});

describe('crashTraceMessageSchema — validación del mensaje Pub/Sub', () => {
  const validMessage = {
    imei: '356307042441013',
    vehicleId: '550e8400-e29b-41d4-a716-446655440000',
    packet: {
      codecId: 142,
      recordCount: 1,
      records: [
        {
          timestampMs: '1700000005000',
          priority: 2,
          gps: {
            longitude: -70.6483,
            latitude: -33.4569,
            altitude: 567,
            angle: 137,
            satellites: 12,
            speedKmh: 80,
          },
          io: {
            eventIoId: 247,
            totalIo: 0,
            entries: [],
          },
        },
      ],
    },
  };

  it('valida un mensaje correcto', () => {
    expect(() => crashTraceMessageSchema.parse(validMessage)).not.toThrow();
  });

  it('rechaza imei vacío', () => {
    expect(() => crashTraceMessageSchema.parse({ ...validMessage, imei: '' })).toThrow();
  });

  it('acepta vehicleId null (device pendiente)', () => {
    expect(() => crashTraceMessageSchema.parse({ ...validMessage, vehicleId: null })).not.toThrow();
  });

  it('rechaza priority fuera de 0/1/2', () => {
    const bad = JSON.parse(JSON.stringify(validMessage));
    bad.packet.records[0].priority = 5;
    expect(() => crashTraceMessageSchema.parse(bad)).toThrow();
  });

  it('rechaza codecId distinto a 8 o 142', () => {
    const bad = JSON.parse(JSON.stringify(validMessage));
    bad.packet.codecId = 7;
    expect(() => crashTraceMessageSchema.parse(bad)).toThrow();
  });
});

describe('bigintReplacer', () => {
  it('convierte BigInt a string', () => {
    expect(JSON.stringify({ a: 123n }, bigintReplacer)).toBe('{"a":"123"}');
  });

  it('preserva otros tipos', () => {
    expect(JSON.stringify({ s: 'x', n: 42, b: true }, bigintReplacer)).toBe(
      '{"s":"x","n":42,"b":true}',
    );
  });

  it('maneja BigInts grandes (epoch ms del timestamp)', () => {
    const big = 1700000005000n;
    expect(JSON.stringify({ ts: big }, bigintReplacer)).toBe('{"ts":"1700000005000"}');
  });
});
