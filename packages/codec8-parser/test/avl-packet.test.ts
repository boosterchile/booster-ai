import { describe, expect, it } from 'vitest';
import { encodeAvlAck, parseAvlPacket } from '../src/avl-packet.js';
import { crc16Ibm } from '../src/crc16.js';
import { CodecCrcError, CodecParseError } from '../src/tipos.js';

/**
 * Construir packets a mano en lugar de hardcodear hex strings:
 *   - Independiente de fixtures pre-computados.
 *   - El CRC se calcula con la misma función que valida el parser
 *     (round-trip: si crc16Ibm está bien, el packet pasa).
 *   - Si la estructura cambia, los helpers se actualizan en un solo lugar.
 */

function envolverPacket(dataField: Buffer): Buffer {
  const preamble = Buffer.alloc(4); // 0x00000000
  const length = Buffer.alloc(4);
  length.writeUInt32BE(dataField.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc16Ibm(dataField) & 0xffff, 0); // hi 2 = 0, lo 2 = crc
  return Buffer.concat([preamble, length, dataField, crc]);
}

function buildCodec8Packet(opts: {
  records: Array<{
    timestampMs: bigint;
    priority: 0 | 1 | 2;
    longitude: number; // grados
    latitude: number;
    altitude: number;
    angle: number;
    satellites: number;
    speedKmh: number;
    eventIoId?: number;
    n1?: Array<[number, number]>; // [id, value]
    n2?: Array<[number, number]>;
    n4?: Array<[number, number]>;
    n8?: Array<[number, bigint]>;
  }>;
}): Buffer {
  const recordCount = opts.records.length;
  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x08, recordCount])); // codec id + count1

  for (const rec of opts.records) {
    const ts = Buffer.alloc(8);
    ts.writeBigUInt64BE(rec.timestampMs, 0);
    parts.push(ts);

    parts.push(Buffer.from([rec.priority]));

    const gps = Buffer.alloc(15);
    gps.writeInt32BE(Math.round(rec.longitude * 1e7), 0);
    gps.writeInt32BE(Math.round(rec.latitude * 1e7), 4);
    gps.writeInt16BE(rec.altitude, 8);
    gps.writeUInt16BE(rec.angle, 10);
    gps.writeUInt8(rec.satellites, 12);
    gps.writeUInt16BE(rec.speedKmh, 13);
    parts.push(gps);

    const n1 = rec.n1 ?? [];
    const n2 = rec.n2 ?? [];
    const n4 = rec.n4 ?? [];
    const n8 = rec.n8 ?? [];
    const totalIo = n1.length + n2.length + n4.length + n8.length;
    parts.push(Buffer.from([rec.eventIoId ?? 0, totalIo]));

    parts.push(Buffer.from([n1.length]));
    for (const [id, v] of n1) {
      parts.push(Buffer.from([id, v]));
    }
    parts.push(Buffer.from([n2.length]));
    for (const [id, v] of n2) {
      const b = Buffer.alloc(3);
      b.writeUInt8(id, 0);
      b.writeUInt16BE(v, 1);
      parts.push(b);
    }
    parts.push(Buffer.from([n4.length]));
    for (const [id, v] of n4) {
      const b = Buffer.alloc(5);
      b.writeUInt8(id, 0);
      b.writeUInt32BE(v, 1);
      parts.push(b);
    }
    parts.push(Buffer.from([n8.length]));
    for (const [id, v] of n8) {
      const b = Buffer.alloc(9);
      b.writeUInt8(id, 0);
      b.writeBigUInt64BE(v, 1);
      parts.push(b);
    }
  }

  parts.push(Buffer.from([recordCount])); // count2
  return envolverPacket(Buffer.concat(parts));
}

describe('parseAvlPacket — Codec 8 (round-trip)', () => {
  const ejemploPacket = buildCodec8Packet({
    records: [
      {
        timestampMs: 1532597995000n, // 2018-07-26 09:39:55 UTC
        priority: 1,
        longitude: -70.6483, // Santiago centro aprox
        latitude: -33.4569,
        altitude: 567,
        angle: 137,
        satellites: 12,
        speedKmh: 60,
        eventIoId: 21,
        n1: [
          [21, 3], // GSM signal level
          [1, 1], // Digital input 1 (ej. ignición)
        ],
        n2: [[24, 0]], // Speed (kmh) repetido como IO
        n4: [[16, 153420]], // Total odometer (m)
        n8: [],
      },
    ],
  });

  it('parsea un packet válido sin tirar', () => {
    const packet = parseAvlPacket(ejemploPacket);
    expect(packet.codecId).toBe(8);
    expect(packet.recordCount).toBe(1);
    expect(packet.records).toHaveLength(1);
  });

  it('preserva timestamp, priority, GPS y IO entries', () => {
    const packet = parseAvlPacket(ejemploPacket);
    const rec = packet.records[0];
    expect(rec).toBeDefined();
    if (!rec) {
      return;
    }
    expect(rec.timestampMs).toBe(1532597995000n);
    expect(rec.priority).toBe(1);
    expect(rec.gps.longitude).toBeCloseTo(-70.6483, 4);
    expect(rec.gps.latitude).toBeCloseTo(-33.4569, 4);
    expect(rec.gps.altitude).toBe(567);
    expect(rec.gps.angle).toBe(137);
    expect(rec.gps.satellites).toBe(12);
    expect(rec.gps.speedKmh).toBe(60);
    expect(rec.io.eventIoId).toBe(21);
    expect(rec.io.totalIo).toBe(4);
    expect(rec.io.entries).toHaveLength(4);
    // Verificar valores específicos
    const e = rec.io.entries;
    expect(e[0]).toEqual({ id: 21, value: 3, byteSize: 1 });
    expect(e[1]).toEqual({ id: 1, value: 1, byteSize: 1 });
    expect(e[2]).toEqual({ id: 24, value: 0, byteSize: 2 });
    expect(e[3]).toEqual({ id: 16, value: 153420, byteSize: 4 });
  });

  it('soporta múltiples records en un packet', () => {
    const multi = buildCodec8Packet({
      records: [
        {
          timestampMs: 1700000000000n,
          priority: 0,
          longitude: 0,
          latitude: 0,
          altitude: 0,
          angle: 0,
          satellites: 0,
          speedKmh: 0,
        },
        {
          timestampMs: 1700000060000n,
          priority: 0,
          longitude: 0,
          latitude: 0,
          altitude: 0,
          angle: 0,
          satellites: 0,
          speedKmh: 0,
        },
      ],
    });
    const p = parseAvlPacket(multi);
    expect(p.recordCount).toBe(2);
    expect(p.records).toHaveLength(2);
    expect(p.records[0]?.timestampMs).toBe(1700000000000n);
    expect(p.records[1]?.timestampMs).toBe(1700000060000n);
  });

  it('rechaza preamble incorrecto', () => {
    const bad = Buffer.from(ejemploPacket);
    bad[0] = 0xff;
    expect(() => parseAvlPacket(bad)).toThrow(/preamble/);
  });

  it('rechaza CRC incorrecto', () => {
    const bad = Buffer.from(ejemploPacket);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0xff;
    expect(() => parseAvlPacket(bad)).toThrow(CodecCrcError);
  });

  it('rechaza codec id desconocido', () => {
    const bad = Buffer.from(ejemploPacket);
    bad[8] = 0x09;
    expect(() => parseAvlPacket(bad)).toThrow(/codec id no soportado/);
  });

  it('rechaza packet con bytes faltantes (truncado)', () => {
    expect(() => parseAvlPacket(ejemploPacket.subarray(0, 20))).toThrow(CodecParseError);
  });

  it('rechaza packet con length declarada distinta a tamaño real', () => {
    const bad = Buffer.from(ejemploPacket);
    bad.writeUInt32BE(999, 4); // length absurda
    expect(() => parseAvlPacket(bad)).toThrow(/no matchea/);
  });
});

describe('encodeAvlAck', () => {
  it('codifica el record count en 4 bytes BE', () => {
    expect(encodeAvlAck(1)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x01]));
    expect(encodeAvlAck(255)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0xff]));
    expect(encodeAvlAck(256)).toEqual(Buffer.from([0x00, 0x00, 0x01, 0x00]));
    expect(encodeAvlAck(0xffffffff)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0xff]));
  });

  it('rechaza valores fuera de rango', () => {
    expect(() => encodeAvlAck(-1)).toThrow(RangeError);
    expect(() => encodeAvlAck(0x100000000)).toThrow(RangeError);
  });
});
