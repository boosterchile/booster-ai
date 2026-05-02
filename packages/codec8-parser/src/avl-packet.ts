import { BufferReader } from './buffer-reader.js';
import { crc16Ibm } from './crc16.js';
import {
  type AvlPacket,
  type AvlRecord,
  CodecCrcError,
  CodecParseError,
  type GpsElement,
  type IoEntry,
  type IoSection,
} from './tipos.js';

/**
 * Estructura del AVL packet (Codec 8 y 8E):
 *
 *   ┌──── Frame ───────────────────────────────────────────────┐
 *   │ Preamble        : 4 B  = 0x00000000                      │
 *   │ Data Field Len  : 4 B  BE = bytes desde Codec ID hasta   │
 *   │                          Number of Data 2 (inclusive)    │
 *   │ ┌─── Data Field ───────────────────────────────────────┐ │
 *   │ │ Codec ID            : 1 B (0x08 = Codec8, 0x8E = 8E)│ │
 *   │ │ Number of Data 1    : 1 B = N records               │ │
 *   │ │ N × AVL Data record :                               │ │
 *   │ │ Number of Data 2    : 1 B = N (debe matchear)       │ │
 *   │ └─────────────────────────────────────────────────────┘ │
 *   │ CRC-16/IBM      : 4 B = los 2 bytes hi son 0, los 2     │
 *   │                  lo son crc16 sobre el Data Field       │
 *   └──────────────────────────────────────────────────────────┘
 *
 * AVL Data record:
 *   - Timestamp: 8 B BE (epoch ms UTC)
 *   - Priority: 1 B (0 / 1 / 2)
 *   - GPS Element: 15 B (lon int32 ×1e-7, lat int32 ×1e-7, alt int16 m,
 *                        angle uint16 deg, sats uint8, speed uint16 km/h)
 *   - IO Element: variable (eventIoId + totalIo + N1/N2/N4/N8 [+ NX en 8E])
 *
 * Para Codec 8 los IO IDs son 1 byte, los counts también. Para Codec 8E
 * los IO IDs son 2 bytes BE y los counts también, más una sección NX
 * adicional para IO de longitud variable.
 */

const PREAMBLE = 0x00000000;
const CODEC_8 = 0x08;
const CODEC_8E = 0x8e;

export function parseAvlPacket(buf: Buffer): AvlPacket {
  if (buf.length < 12) {
    throw new CodecParseError(`packet demasiado corto: ${buf.length} bytes`);
  }

  const r = new BufferReader(buf);

  const preamble = r.readUInt32BE();
  if (preamble !== PREAMBLE) {
    throw new CodecParseError(
      `preamble inválido: 0x${preamble.toString(16).padStart(8, '0')} (esperado 0x00000000)`,
      0,
    );
  }

  const dataFieldLength = r.readUInt32BE();
  if (dataFieldLength < 3) {
    throw new CodecParseError(`data field length absurdo: ${dataFieldLength}`, 4);
  }
  if (8 + dataFieldLength + 4 !== buf.length) {
    throw new CodecParseError(
      `tamaño de packet no matchea: header dice ${dataFieldLength} bytes data + 4 CRC + 8 header = ${8 + dataFieldLength + 4}, pero buffer tiene ${buf.length}`,
      4,
    );
  }

  const dataFieldStart = r.position;
  const codecId = r.readUInt8();
  if (codecId !== CODEC_8 && codecId !== CODEC_8E) {
    throw new CodecParseError(
      `codec id no soportado: 0x${codecId.toString(16)} (esperado 0x08 Codec 8 o 0x8E Codec 8E)`,
      dataFieldStart,
    );
  }
  const isExtended = codecId === CODEC_8E;

  const recordCount = r.readUInt8();

  const records: AvlRecord[] = [];
  for (let i = 0; i < recordCount; i++) {
    records.push(readAvlRecord(r, isExtended));
  }

  const recordCount2 = r.readUInt8();
  if (recordCount2 !== recordCount) {
    throw new CodecParseError(
      `Number of Data 2 (${recordCount2}) no coincide con Number of Data 1 (${recordCount})`,
      r.position - 1,
    );
  }

  const dataFieldEnd = r.position;

  // CRC-16/IBM sobre el data field. El packet tiene 4 bytes CRC pero los
  // 2 hi son siempre 0; el CRC útil son los 2 lo. Validamos contra los
  // 4 bytes leídos como uint32 BE — los hi deberían ser 0.
  const crcHi = r.readUInt16BE();
  const crcLo = r.readUInt16BE();
  if (crcHi !== 0) {
    throw new CodecParseError(`CRC trailer hi != 0: 0x${crcHi.toString(16)}`, r.position - 4);
  }
  const crcExpected = crcLo;
  const crcActual = crc16Ibm(buf, dataFieldStart, dataFieldEnd);
  if (crcExpected !== crcActual) {
    throw new CodecCrcError(crcExpected, crcActual);
  }

  return {
    codecId: codecId as 8 | 142,
    recordCount,
    records,
  };
}

function readAvlRecord(r: BufferReader, isExtended: boolean): AvlRecord {
  const timestampMs = r.readBigUInt64BE();
  const priorityByte = r.readUInt8();
  if (priorityByte !== 0 && priorityByte !== 1 && priorityByte !== 2) {
    throw new CodecParseError(
      `priority inválido: ${priorityByte} (esperado 0 / 1 / 2)`,
      r.position - 1,
    );
  }
  const priority = priorityByte as 0 | 1 | 2;

  const gps = readGpsElement(r);
  const io = readIoSection(r, isExtended);

  return { timestampMs, priority, gps, io };
}

function readGpsElement(r: BufferReader): GpsElement {
  const lonRaw = r.readInt32BE();
  const latRaw = r.readInt32BE();
  const altitude = r.readInt16BE();
  const angle = r.readUInt16BE();
  const satellites = r.readUInt8();
  const speedKmh = r.readUInt16BE();
  return {
    longitude: lonRaw / 1e7,
    latitude: latRaw / 1e7,
    altitude,
    angle,
    satellites,
    speedKmh,
  };
}

function readIoSection(r: BufferReader, isExtended: boolean): IoSection {
  // En Codec 8, el Event IO ID y el Total IO son 1 byte cada uno.
  // En Codec 8E, son 2 bytes BE cada uno.
  const eventIoId = isExtended ? r.readUInt16BE() : r.readUInt8();
  const totalIo = isExtended ? r.readUInt16BE() : r.readUInt8();

  const entries: IoEntry[] = [];

  // Helper para leer un grupo de N IO de tamaño fijo (1/2/4/8 bytes).
  const readGroup = (byteSize: 1 | 2 | 4 | 8) => {
    const count = isExtended ? r.readUInt16BE() : r.readUInt8();
    for (let i = 0; i < count; i++) {
      const id = isExtended ? r.readUInt16BE() : r.readUInt8();
      let value: number | bigint;
      if (byteSize === 1) {
        value = r.readUInt8();
      } else if (byteSize === 2) {
        value = r.readUInt16BE();
      } else if (byteSize === 4) {
        value = r.readUInt32BE();
      } else {
        // byteSize === 8
        value = r.readBigUInt64BE();
      }
      entries.push({ id, value, byteSize });
    }
  };

  readGroup(1);
  readGroup(2);
  readGroup(4);
  readGroup(8);

  // Codec 8E tiene un grupo adicional NX (variable length).
  if (isExtended) {
    const nxCount = r.readUInt16BE();
    for (let i = 0; i < nxCount; i++) {
      const id = r.readUInt16BE();
      const length = r.readUInt16BE();
      const value = r.readBytes(length);
      entries.push({ id, value, byteSize: null });
    }
  }

  if (entries.length !== totalIo) {
    throw new CodecParseError(
      `IO count mismatch: total declarado ${totalIo}, parseado ${entries.length}`,
      r.position,
    );
  }

  return { eventIoId, totalIo, entries };
}

/**
 * Codifica el ACK que el server manda al device tras un AVL packet.
 *
 *   4 bytes BE = número de records aceptados.
 *
 * Si el server envía recordCount = N, el device borra N records de su
 * buffer interno y arranca el siguiente lote desde el record N+1.
 * Mandar recordCount distinto al recibido es protocolo válido si el
 * server quiere descartar parte del lote (raro).
 */
export function encodeAvlAck(recordCount: number): Buffer {
  if (recordCount < 0 || recordCount > 0xffffffff) {
    throw new RangeError(`recordCount fuera de rango uint32: ${recordCount}`);
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(recordCount, 0);
  return buf;
}
