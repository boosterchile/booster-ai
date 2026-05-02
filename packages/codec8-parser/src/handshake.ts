import { BufferReader } from './buffer-reader.js';
import { CodecParseError, type ImeiHandshake } from './tipos.js';

/**
 * Parsea el primer paquete que envía el device tras conectar TCP:
 *
 *   [2B BE length] [N bytes ASCII IMEI]
 *
 * Típicamente length=15 (IMEI estándar IEEE). Algunos devices Teltonika
 * usan IMEI de 16 (con check digit) o 14 (legacy). El parser acepta
 * cualquier length 8-20 (rango razonable).
 *
 * Server responde con encodeImeiAck(true|false). True = aceptado, false
 * = rechazado (device cierra conexión y reintenta).
 */
export function parseImeiHandshake(buf: Buffer): ImeiHandshake {
  const r = new BufferReader(buf);
  const length = r.readUInt16BE();
  if (length < 8 || length > 20) {
    throw new CodecParseError(`IMEI length fuera de rango razonable: ${length}`, 0);
  }
  const imeiBytes = r.readBytes(length);
  const imei = imeiBytes.toString('ascii');
  if (!/^\d+$/.test(imei)) {
    throw new CodecParseError(`IMEI no es ASCII numérico: "${imei}"`, 2);
  }
  return { imei };
}

/**
 * Codifica la respuesta del server al IMEI handshake.
 *
 *   - 0x01 = aceptado, device empieza a enviar AVL packets.
 *   - 0x00 = rechazado, device cierra conexión y reintenta más tarde
 *            (con backoff configurable en el firmware).
 */
export function encodeImeiAck(accept: boolean): Buffer {
  return Buffer.from([accept ? 0x01 : 0x00]);
}
