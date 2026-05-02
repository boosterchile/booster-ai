/**
 * CRC-16/IBM (también llamado CRC-16/ARC, ANSI, MODBUS sin XOR final).
 *
 * Parámetros (catalog crccalc.com):
 *   - Polinomio: 0x8005 (representación reversed: 0xA001)
 *   - Init: 0x0000
 *   - RefIn: true (LSB first)
 *   - RefOut: true (LSB first)
 *   - XorOut: 0x0000
 *
 * Teltonika usa esta variante en el trailer de cada AVL packet (4 bytes:
 * los 2 bytes hi son 0x0000, los 2 bytes lo son el CRC). El CRC se
 * calcula sobre el data field (desde Codec ID hasta el segundo Number
 * of Data inclusive).
 *
 * Implementación: tabla precomputada para velocidad. La tabla de 256
 * entries se construye en module load (~2KB de memoria).
 */

const POLY_REVERSED = 0xa001;

const TABLE: Uint16Array = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ POLY_REVERSED : crc >>> 1;
    }
    t[i] = crc;
  }
  return t;
})();

/**
 * Calcula CRC-16/IBM sobre los bytes dados.
 *
 * @param data Buffer con los bytes a checksumear
 * @param start Offset inclusivo (default 0)
 * @param end Offset exclusivo (default data.length)
 */
export function crc16Ibm(data: Buffer, start = 0, end = data.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = data[i];
    if (byte === undefined) {
      // Esto no debería pasar dada la validación del caller, pero es
      // defensa explícita para satisfacer el strict null checks de TS.
      throw new Error(`crc16Ibm: byte undefined at offset ${i}`);
    }
    const tableIndex = (crc ^ byte) & 0xff;
    const tableValue = TABLE[tableIndex];
    if (tableValue === undefined) {
      throw new Error(`crc16Ibm: tabla inválida en idx ${tableIndex}`);
    }
    crc = (crc >>> 8) ^ tableValue;
  }
  return crc & 0xffff;
}
