import { describe, expect, it } from 'vitest';
import {
  GREEN_DRIVING_TYPE_AVL_ID,
  GREEN_DRIVING_VALUE_AVL_ID,
  OVER_SPEEDING_AVL_ID,
  extractGreenDrivingEvents,
  extractGreenDrivingEventsFromPacket,
  hasGreenDrivingEvent,
} from '../src/green-driving.js';
import type { AvlPacket, AvlRecord, GpsElement, IoEntry } from '../src/tipos.js';

/**
 * Tests del extractor de Green Driving (Phase 2 PR-I1).
 *
 * Construimos AvlRecords manualmente — no parseamos bytes acá. La
 * lógica del parser binario está testeada por separado en
 * avl-packet.test.ts. Acá solo cubrimos la capa semántica: dado un
 * record con N IO entries, ¿extraemos los eventos correctos?
 */

const GPS_FIX: GpsElement = {
  longitude: -70.6504,
  latitude: -33.4378,
  altitude: 540,
  angle: 180,
  satellites: 12,
  speedKmh: 85,
};

function makeRecord(opts: {
  timestampMs?: bigint;
  priority?: 0 | 1 | 2;
  ioEntries: IoEntry[];
  eventIoId?: number;
  gps?: GpsElement;
}): AvlRecord {
  return {
    timestampMs: opts.timestampMs ?? 1_777_000_000_000n,
    priority: opts.priority ?? 1,
    gps: opts.gps ?? GPS_FIX,
    io: {
      eventIoId: opts.eventIoId ?? 0,
      totalIo: opts.ioEntries.length,
      entries: opts.ioEntries,
    },
  };
}

function makeIo(id: number, value: number | bigint | Buffer, byteSize: 1 | 2 | 4 | 8 = 1): IoEntry {
  return { id, value, byteSize };
}

describe('extractGreenDrivingEvents — harsh accel/brake/cornering', () => {
  it('IO 253 value=1 → harsh_acceleration', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1), makeIo(GREEN_DRIVING_VALUE_AVL_ID, 1850)],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('harsh_acceleration');
    expect(events[0]?.severity).toBe(1850);
    expect(events[0]?.unit).toBe('mG');
    expect(events[0]?.timestampMs).toBe(1_777_000_000_000n);
  });

  it('IO 253 value=2 → harsh_braking', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 2), makeIo(GREEN_DRIVING_VALUE_AVL_ID, 2400)],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('harsh_braking');
    expect(events[0]?.severity).toBe(2400);
  });

  it('IO 253 value=3 → harsh_cornering', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 3), makeIo(GREEN_DRIVING_VALUE_AVL_ID, 1200)],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events[0]?.type).toBe('harsh_cornering');
  });

  it('IO 253 sin IO 254 → severity defaults a 0', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1)],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events[0]?.severity).toBe(0);
  });

  it('IO 253 con value fuera de rango (4) → ignorado (no event)', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 4), makeIo(GREEN_DRIVING_VALUE_AVL_ID, 999)],
    });
    expect(extractGreenDrivingEvents(record)).toEqual([]);
  });

  it('IO 253 con value 0 → ignorado', () => {
    const record = makeRecord({
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 0)],
    });
    expect(extractGreenDrivingEvents(record)).toEqual([]);
  });
});

describe('extractGreenDrivingEvents — over-speeding', () => {
  it('IO 255 value > 0 → over_speed con severity en km/h', () => {
    const record = makeRecord({
      ioEntries: [makeIo(OVER_SPEEDING_AVL_ID, 115, 2)],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('over_speed');
    expect(events[0]?.severity).toBe(115);
    expect(events[0]?.unit).toBe('km/h');
  });

  it('IO 255 value = 0 → ignorado (threshold-based: 0 = no excedió)', () => {
    const record = makeRecord({
      ioEntries: [makeIo(OVER_SPEEDING_AVL_ID, 0)],
    });
    expect(extractGreenDrivingEvents(record)).toEqual([]);
  });
});

describe('extractGreenDrivingEvents — múltiples eventos en un record', () => {
  it('IO 253 + IO 255 simultáneos → 2 eventos (harsh + over_speed)', () => {
    // Caso real: el conductor frena fuerte cuando ya iba sobre el límite.
    const record = makeRecord({
      ioEntries: [
        makeIo(GREEN_DRIVING_TYPE_AVL_ID, 2),
        makeIo(GREEN_DRIVING_VALUE_AVL_ID, 1900),
        makeIo(OVER_SPEEDING_AVL_ID, 110, 2),
      ],
    });
    const events = extractGreenDrivingEvents(record);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.type).sort()).toEqual(['harsh_braking', 'over_speed']);
  });

  it('record sin ningún green-driving IO → []', () => {
    const record = makeRecord({
      ioEntries: [
        makeIo(239, 1), // ignition
        makeIo(16, 123456, 4), // total odometer
      ],
    });
    expect(extractGreenDrivingEvents(record)).toEqual([]);
  });
});

describe('extractGreenDrivingEvents — defensive parsing', () => {
  it('IO value como bigint se convierte correctamente', () => {
    const record = makeRecord({
      ioEntries: [
        makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1n, 1),
        makeIo(GREEN_DRIVING_VALUE_AVL_ID, 1850n, 2),
      ],
    });
    const [event] = extractGreenDrivingEvents(record);
    expect(event?.type).toBe('harsh_acceleration');
    expect(event?.severity).toBe(1850);
  });

  it('IO value como Buffer (NX entry) se decodifica como uint8/16/32', () => {
    const buf2 = Buffer.alloc(2);
    buf2.writeUInt16BE(2400, 0);
    const record = makeRecord({
      ioEntries: [
        makeIo(GREEN_DRIVING_TYPE_AVL_ID, 2, 1),
        { id: GREEN_DRIVING_VALUE_AVL_ID, value: buf2, byteSize: null },
      ],
    });
    const [event] = extractGreenDrivingEvents(record);
    expect(event?.severity).toBe(2400);
  });

  it('GPS del record se propaga en el evento', () => {
    const record = makeRecord({
      gps: { ...GPS_FIX, latitude: -36.8201, longitude: -73.0444 },
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1)],
    });
    const [event] = extractGreenDrivingEvents(record);
    expect(event?.gps.latitude).toBe(-36.8201);
    expect(event?.gps.longitude).toBe(-73.0444);
  });

  it('timestamp del record se propaga al evento', () => {
    const record = makeRecord({
      timestampMs: 1_800_000_000_000n,
      ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1)],
    });
    const [event] = extractGreenDrivingEvents(record);
    expect(event?.timestampMs).toBe(1_800_000_000_000n);
  });
});

describe('extractGreenDrivingEventsFromPacket', () => {
  function makePacket(records: AvlRecord[]): AvlPacket {
    return { codecId: 0x08, recordCount: records.length, records };
  }

  it('extrae eventos de TODOS los records de un packet', () => {
    const packet = makePacket([
      makeRecord({
        timestampMs: 1n,
        ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1)],
      }),
      makeRecord({
        timestampMs: 2n,
        ioEntries: [makeIo(OVER_SPEEDING_AVL_ID, 105, 2)],
      }),
      makeRecord({
        timestampMs: 3n,
        ioEntries: [makeIo(239, 1)], // record sin green driving
      }),
    ]);
    const events = extractGreenDrivingEventsFromPacket(packet);
    expect(events).toHaveLength(2);
    expect(events[0]?.timestampMs).toBe(1n);
    expect(events[1]?.timestampMs).toBe(2n);
  });

  it('packet sin green-driving en ningún record → []', () => {
    const packet = makePacket([
      makeRecord({ ioEntries: [makeIo(239, 1)] }),
      makeRecord({ ioEntries: [makeIo(16, 1000, 4)] }),
    ]);
    expect(extractGreenDrivingEventsFromPacket(packet)).toEqual([]);
  });
});

describe('hasGreenDrivingEvent — fast path', () => {
  function makePacket(records: AvlRecord[]): AvlPacket {
    return { codecId: 0x08, recordCount: records.length, records };
  }

  it('true si algún record tiene IO 253', () => {
    const packet = makePacket([
      makeRecord({ ioEntries: [makeIo(239, 1)] }),
      makeRecord({ ioEntries: [makeIo(GREEN_DRIVING_TYPE_AVL_ID, 1)] }),
    ]);
    expect(hasGreenDrivingEvent(packet)).toBe(true);
  });

  it('true si algún record tiene IO 255', () => {
    const packet = makePacket([makeRecord({ ioEntries: [makeIo(OVER_SPEEDING_AVL_ID, 110, 2)] })]);
    expect(hasGreenDrivingEvent(packet)).toBe(true);
  });

  it('false si ningún record tiene green-driving IDs', () => {
    const packet = makePacket([makeRecord({ ioEntries: [makeIo(239, 1), makeIo(16, 5000, 4)] })]);
    expect(hasGreenDrivingEvent(packet)).toBe(false);
  });

  it('false en packet vacío', () => {
    const packet = makePacket([]);
    expect(hasGreenDrivingEvent(packet)).toBe(false);
  });
});
