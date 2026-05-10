/**
 * @booster-ai/codec8-parser
 *
 * Parser puro del protocolo Teltonika Codec 8 / Codec 8 Extended (8E).
 * Spec oficial: https://wiki.teltonika-gps.com/view/Codec
 *
 * API pública:
 *
 *   import {
 *     parseImeiHandshake, encodeImeiAck,
 *     parseAvlPacket,    encodeAvlAck,
 *   } from '@booster-ai/codec8-parser';
 *
 *   // 1. Cliente abre TCP, manda IMEI handshake.
 *   const { imei } = parseImeiHandshake(firstPacket);
 *   socket.write(encodeImeiAck(true));
 *
 *   // 2. Cliente manda AVL packets repetidamente.
 *   const packet = parseAvlPacket(avlBuffer);
 *   socket.write(encodeAvlAck(packet.recordCount));
 *
 * Responsabilidad del package: BYTES → OBJETOS (y viceversa para acks).
 * Toda otra lógica (auth, dedup, persist, mapping IO IDs a semántica)
 * vive en otros paquetes del monorepo.
 */

export { parseImeiHandshake, encodeImeiAck } from './handshake.js';
export { parseAvlPacket, encodeAvlAck } from './avl-packet.js';
export { crc16Ibm } from './crc16.js';
export { BufferReader } from './buffer-reader.js';
export type {
  AvlPacket,
  AvlRecord,
  GpsElement,
  IoSection,
  IoEntry,
  ImeiHandshake,
} from './tipos.js';
export { CodecParseError, CodecCrcError } from './tipos.js';

// Crash Trace forensics (Wave 2 Track B3)
export {
  CRASH_EVENT_AVL_ID,
  ACCEL_AXIS_X_AVL_ID,
  ACCEL_AXIS_Y_AVL_ID,
  ACCEL_AXIS_Z_AVL_ID,
  isCrashTracePacket,
  extractCrashTrace,
  type AccelSample,
  type GnssSample,
  type IoSnapshot,
  type CrashTrace,
} from './crash-trace.js';

// Green Driving + Over-Speeding events (Phase 2 — driver behavior scoring)
export {
  GREEN_DRIVING_TYPE_AVL_ID,
  GREEN_DRIVING_VALUE_AVL_ID,
  OVER_SPEEDING_AVL_ID,
  extractGreenDrivingEvents,
  extractGreenDrivingEventsFromPacket,
  hasGreenDrivingEvent,
  type GreenDrivingEvent,
  type GreenDrivingEventType,
} from './green-driving.js';
