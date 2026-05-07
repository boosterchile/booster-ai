import { describe, expect, it } from 'vitest';
import {
  ACCEL_AXIS_X_AVL_ID,
  ACCEL_AXIS_Y_AVL_ID,
  ACCEL_AXIS_Z_AVL_ID,
  CRASH_EVENT_AVL_ID,
  extractCrashTrace,
  isCrashTracePacket,
} from '../src/crash-trace.js';
import type { AvlPacket, AvlRecord, IoEntry } from '../src/tipos.js';

/**
 * Helpers para construir AvlPacket sintético sin pasar por el parser
 * binario. El extractor opera sobre AvlPacket ya parseado, así que los
 * tests cubren la lógica semántica directamente.
 */

function gps(opts: Partial<AvlRecord['gps']> = {}) {
  return {
    longitude: -70.6483,
    latitude: -33.4569,
    altitude: 567,
    angle: 0,
    satellites: 10,
    speedKmh: 0,
    ...opts,
  };
}

function ioEntry(id: number, value: number, byteSize: 1 | 2 | 4 | 8 = 2): IoEntry {
  return { id, value, byteSize };
}

function record(opts: {
  timestampMs: bigint;
  priority?: 0 | 1 | 2;
  gps?: Partial<AvlRecord['gps']>;
  eventIoId?: number;
  entries?: IoEntry[];
}): AvlRecord {
  const entries = opts.entries ?? [];
  return {
    timestampMs: opts.timestampMs,
    priority: opts.priority ?? 0,
    gps: gps(opts.gps),
    io: {
      eventIoId: opts.eventIoId ?? 0,
      totalIo: entries.length,
      entries,
    },
  };
}

function packet(records: AvlRecord[]): AvlPacket {
  return {
    codecId: 142, // Codec 8 Extended (Crash Trace siempre es 8E)
    recordCount: records.length,
    records,
  };
}

/**
 * Construye los 3 entries de acelerómetro (X, Y, Z en mG signed).
 * El parser real entrega RAW uint16; los negativos vienen como
 * complemento (ej. -100 mG = 0xFF9C = 65436).
 */
function accelEntries(xMg: number, yMg: number, zMg: number): IoEntry[] {
  const toUint16 = (v: number) => (v < 0 ? v + 0x10000 : v);
  return [
    ioEntry(ACCEL_AXIS_X_AVL_ID, toUint16(xMg)),
    ioEntry(ACCEL_AXIS_Y_AVL_ID, toUint16(yMg)),
    ioEntry(ACCEL_AXIS_Z_AVL_ID, toUint16(zMg)),
  ];
}

describe('isCrashTracePacket — Wave 2 Track B3', () => {
  it('detecta packet con record priority panic + eventIoId 247', () => {
    const p = packet([
      record({
        timestampMs: 1700000000000n,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
      }),
    ]);
    expect(isCrashTracePacket(p)).toBe(true);
  });

  it('NO detecta packet con priority panic pero eventIoId distinto', () => {
    const p = packet([
      record({
        timestampMs: 1700000000000n,
        priority: 2,
        eventIoId: 252, // Unplug, también es panic pero NO es Crash
      }),
    ]);
    expect(isCrashTracePacket(p)).toBe(false);
  });

  it('NO detecta packet con eventIoId 247 pero priority distinta de panic', () => {
    const p = packet([
      record({
        timestampMs: 1700000000000n,
        priority: 1,
        eventIoId: CRASH_EVENT_AVL_ID,
      }),
    ]);
    expect(isCrashTracePacket(p)).toBe(false);
  });

  it('detecta el Crash event aunque sea uno de muchos records', () => {
    const p = packet([
      record({ timestampMs: 1700000000000n, priority: 0 }),
      record({ timestampMs: 1700000001000n, priority: 1 }),
      record({
        timestampMs: 1700000002000n,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
      }),
      record({ timestampMs: 1700000003000n, priority: 0 }),
    ]);
    expect(isCrashTracePacket(p)).toBe(true);
  });

  it('packet vacío → false', () => {
    expect(isCrashTracePacket(packet([]))).toBe(false);
  });
});

describe('extractCrashTrace — extracción semántica', () => {
  it('retorna null si el packet no es Crash Trace', () => {
    const p = packet([record({ timestampMs: 1700000000000n })]);
    expect(extractCrashTrace(p)).toBeNull();
  });

  it('extrae timestamp del record con eventIoId 247', () => {
    const crashTs = 1700000005000n;
    const p = packet([
      record({ timestampMs: 1700000000000n }),
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(2000, 100, 200),
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace).not.toBeNull();
    expect(trace?.crashTimestampMs).toBe(crashTs);
  });

  it('extrae acelerómetro: cada record con AVL 17/18/19 → AccelSample', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs - 10n,
        entries: accelEntries(50, 0, 980), // 1G en Z, casi neutro
      }),
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(3000, -2500, 1500), // impacto
      }),
      record({
        timestampMs: crashTs + 10n,
        entries: accelEntries(-100, 200, 950),
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.accelerometer).toHaveLength(3);
    expect(trace?.accelerometer[0]).toEqual({ tMsOffset: -10, xMg: 50, yMg: 0, zMg: 980 });
    expect(trace?.accelerometer[1]).toEqual({ tMsOffset: 0, xMg: 3000, yMg: -2500, zMg: 1500 });
    expect(trace?.accelerometer[2]).toEqual({ tMsOffset: 10, xMg: -100, yMg: 200, zMg: 950 });
  });

  it('peakGForce calculado correctamente desde la muestra de mayor magnitud', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(3000, 4000, 0), // sqrt(9M+16M) = 5000 mG = 5.0 G
      }),
      record({
        timestampMs: crashTs + 10n,
        entries: accelEntries(0, 0, 1000), // 1.0 G
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.peakGForce).toBeCloseTo(5.0, 5);
  });

  it('peakGForce = 0 cuando no hay samples de acelerómetro', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: [ioEntry(239, 1, 1)], // ignition, no accel
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.peakGForce).toBe(0);
    expect(trace?.accelerometer).toHaveLength(0);
  });

  it('record con sólo X e Y (sin Z) NO genera AccelSample', () => {
    const crashTs = 1700000000000n;
    const toUint16 = (v: number) => (v < 0 ? v + 0x10000 : v);
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: [
          ioEntry(ACCEL_AXIS_X_AVL_ID, toUint16(100)),
          ioEntry(ACCEL_AXIS_Y_AVL_ID, toUint16(200)),
          // falta Z
        ],
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.accelerometer).toHaveLength(0);
  });

  it('extrae GNSS samples: cada record con satellites > 0', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        gps: { satellites: 12, speedKmh: 80, longitude: -70.5, latitude: -33.5, angle: 90 },
      }),
      record({
        timestampMs: crashTs + 1000n,
        gps: { satellites: 8, speedKmh: 0, longitude: -70.5, latitude: -33.5 },
      }),
      record({
        timestampMs: crashTs + 2000n,
        gps: { satellites: 0 }, // sin fix → no genera GnssSample
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.gnss).toHaveLength(2);
    expect(trace?.gnss[0]?.tMsOffset).toBe(0);
    expect(trace?.gnss[0]?.speedKmh).toBe(80);
    expect(trace?.gnss[1]?.tMsOffset).toBe(1000);
    expect(trace?.gnss[1]?.speedKmh).toBe(0);
  });

  it('IoSnapshot incluye entries no-acelerómetro y NO duplica accel', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: [
          ...accelEntries(100, 200, 1000),
          ioEntry(239, 1, 1), // ignition
          ioEntry(66, 12500, 2), // external voltage
        ],
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.io).toHaveLength(1);
    const ioEntries = trace?.io[0]?.entries ?? [];
    expect(ioEntries).toHaveLength(2);
    expect(ioEntries.map((e) => e.id).sort((a, b) => a - b)).toEqual([66, 239]);
  });

  it('records ordenados cronológicamente aunque lleguen desordenados', () => {
    const crashTs = 1700000010000n;
    const p = packet([
      record({
        timestampMs: crashTs + 50n,
        entries: accelEntries(0, 0, 1000),
      }),
      record({
        timestampMs: crashTs - 50n,
        entries: accelEntries(0, 0, 999),
      }),
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(2000, 0, 2000),
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.accelerometer.map((s) => s.tMsOffset)).toEqual([-50, 0, 50]);
  });

  it('durationMs = span total del packet', () => {
    const crashTs = 1700000005000n;
    const p = packet([
      record({ timestampMs: crashTs - 5000n, entries: accelEntries(0, 0, 1000) }),
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(2000, 0, 2000),
      }),
      record({ timestampMs: crashTs + 5000n, entries: accelEntries(0, 0, 1000) }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.durationMs).toBe(10000); // 10 segundos
  });

  it('escenario realista: 1000 muestras accel + 20 GNSS + 5 IO snapshots', () => {
    const crashTs = 1700000005000n;
    const records: AvlRecord[] = [];
    // Crash event marker
    records.push(
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(3500, -2800, 1200),
      }),
    );
    // 1000 samples de accel a 100Hz (cada 10ms) cubriendo 5s antes + 5s después
    for (let i = 0; i < 1000; i++) {
      const offsetMs = (i - 500) * 10;
      records.push(
        record({
          timestampMs: BigInt(Number(crashTs) + offsetMs),
          entries: accelEntries(50, 50, 1000),
        }),
      );
    }
    // 20 GNSS samples a 1Hz cubriendo 10s antes + 10s después
    for (let i = 0; i < 20; i++) {
      const offsetMs = (i - 10) * 1000;
      records.push(
        record({
          timestampMs: BigInt(Number(crashTs) + offsetMs),
          gps: { satellites: 10, speedKmh: 60 },
        }),
      );
    }
    const p = packet(records);

    const trace = extractCrashTrace(p);
    expect(trace).not.toBeNull();
    // 1000 + 1 (event marker con accel) = 1001 samples
    expect(trace?.accelerometer.length).toBeGreaterThanOrEqual(1000);
    // 20 GNSS records con satellites > 0 + el event marker (que tiene gps default)
    expect(trace?.gnss.length).toBeGreaterThanOrEqual(20);
  });
});

describe('extractCrashTrace — robustez', () => {
  it('packets de tamaño grande no causan OOM (escenario 1040 records)', () => {
    const crashTs = 1700000005000n;
    const records: AvlRecord[] = [
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(3000, -2000, 1500),
      }),
    ];
    for (let i = 0; i < 1040; i++) {
      records.push(
        record({
          timestampMs: BigInt(Number(crashTs) + (i - 520) * 10),
          entries: accelEntries(50, 50, 1000),
        }),
      );
    }
    expect(() => extractCrashTrace(packet(records))).not.toThrow();
  });

  it('record con value bigint en el accel (impossible RAW) → ignorado, no crash', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: [
          { id: ACCEL_AXIS_X_AVL_ID, value: 100n, byteSize: 8 },
          { id: ACCEL_AXIS_Y_AVL_ID, value: 100n, byteSize: 8 },
          { id: ACCEL_AXIS_Z_AVL_ID, value: 100n, byteSize: 8 },
        ],
      }),
    ]);
    const trace = extractCrashTrace(p);
    // bigint values son ignorados (typeof !== 'number'), accel queda incompleto
    expect(trace?.accelerometer).toHaveLength(0);
  });

  it('packet con UN solo record que ES el crash event marker', () => {
    const crashTs = 1700000000000n;
    const p = packet([
      record({
        timestampMs: crashTs,
        priority: 2,
        eventIoId: CRASH_EVENT_AVL_ID,
        entries: accelEntries(2000, 1000, 800),
      }),
    ]);
    const trace = extractCrashTrace(p);
    expect(trace?.crashTimestampMs).toBe(crashTs);
    expect(trace?.accelerometer).toHaveLength(1);
    expect(trace?.durationMs).toBe(0);
  });
});
