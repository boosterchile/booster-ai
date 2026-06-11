import { describe, expect, it, vi } from 'vitest';
import { detectPanicEvents, logPanicEvents } from '../src/panic-events.js';
import type { RecordMessage } from '../src/persist.js';

function makeMsg(entries: Array<{ id: number; value: number | string }>): RecordMessage {
  return {
    imei: '356307042441013',
    vehicleId: '11111111-2222-3333-4444-555555555555',
    record: {
      timestampMs: '1700000000000',
      priority: 2,
      gps: {
        longitude: -70.6,
        latitude: -33.4,
        altitude: 500,
        angle: 0,
        satellites: 9,
        speedKmh: 0,
      },
      io: {
        eventIoId: entries[0]?.id ?? 0,
        totalIo: entries.length,
        entries: entries.map((e) => ({ ...e, byteSize: 1 as const })),
      },
    },
  };
}

describe('detectPanicEvents', () => {
  it('IO 252 valor 1 → Unplug (T1)', () => {
    expect(detectPanicEvents(makeMsg([{ id: 252, value: 1 }]))).toEqual([
      { eventName: 'Unplug', avlId: 252, rawValue: 1 },
    ]);
  });

  it('IO 252 valor 0 (conectado) → nada (T2)', () => {
    expect(detectPanicEvents(makeMsg([{ id: 252, value: 0 }]))).toEqual([]);
  });

  it('IO 318 valor 2 → GnssJamming crítico; string "2" del path SMS → ídem (T3)', () => {
    expect(detectPanicEvents(makeMsg([{ id: 318, value: 2 }]))).toEqual([
      { eventName: 'GnssJamming', avlId: 318, rawValue: 2 },
    ]);
    expect(detectPanicEvents(makeMsg([{ id: 318, value: '2' }]))).toEqual([
      { eventName: 'GnssJamming', avlId: 318, rawValue: 2 },
    ]);
  });

  it('IO 318 valor 0 → nada; valor no numérico → nada sin throw (T4)', () => {
    expect(detectPanicEvents(makeMsg([{ id: 318, value: 0 }]))).toEqual([]);
    expect(detectPanicEvents(makeMsg([{ id: 318, value: 'garbage' }]))).toEqual([]);
  });

  it('IOs no-panic (240, 253) → nada', () => {
    expect(
      detectPanicEvents(
        makeMsg([
          { id: 240, value: 1 },
          { id: 253, value: 900 },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('logPanicEvents (contrato con telemetry-monitoring.tf)', () => {
  it('record con ambos IOs → 2 warns con eventName/rawValue exactos (T5)', () => {
    const warn = vi.fn();
    const logger = { warn } as never;
    const msg = makeMsg([
      { id: 252, value: 1 },
      { id: 318, value: 2 },
    ]);

    const count = logPanicEvents({ logger, msg, messageId: 'm-1' });

    expect(count).toBe(2);
    // Literales EXACTOS del filtro de los log-metrics — no renombrar.
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Unplug',
        rawValue: 1,
        imei: msg.imei,
        vehicleId: msg.vehicleId,
      }),
      expect.stringContaining('Unplug'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'GnssJamming', rawValue: 2 }),
      expect.stringContaining('GnssJamming'),
    );
  });

  it('record sin panic → 0 warns', () => {
    const warn = vi.fn();
    expect(
      logPanicEvents({
        logger: { warn } as never,
        msg: makeMsg([{ id: 240, value: 1 }]),
        messageId: 'm',
      }),
    ).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });
});
