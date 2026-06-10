/**
 * CRC32C (Castagnoli, polinomio 0x1EDC6F41 reflejado → 0x82F63B78).
 * Implementación table-based pura para validar integridad de transporte
 * con Cloud KMS (`digestCrc32c` / `signatureCrc32c` de asymmetricSign).
 *
 * Sin dependencia externa: la alternativa npm (`fast-crc32c`) agrega un
 * binding nativo por ~25 líneas de tabla (spec §8.A).
 */

const CRC32C_TABLE = new Uint32Array(256);

for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
  }
  CRC32C_TABLE[n] = c >>> 0;
}

/**
 * CRC32C de `data` como entero sin signo de 32 bits (0..4294967295).
 * Vector de referencia (RFC 3720 §B.4): crc32c("123456789") = 0xE3069283.
 */
export function crc32c(data: Buffer | Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC32C_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
