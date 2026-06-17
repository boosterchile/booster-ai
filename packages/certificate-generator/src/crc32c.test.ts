import { describe, expect, it } from 'vitest';
import { crc32c } from './crc32c.js';

describe('crc32c (Castagnoli)', () => {
  it('vector RFC 3720: "123456789" → 0xE3069283', () => {
    expect(crc32c(Buffer.from('123456789', 'ascii'))).toBe(0xe3069283);
  });

  it('buffer vacío → 0', () => {
    expect(crc32c(Buffer.alloc(0))).toBe(0);
  });

  it('vector RFC 3720: 32 bytes de ceros → 0x8A9136AA', () => {
    expect(crc32c(Buffer.alloc(32, 0x00))).toBe(0x8a9136aa);
  });

  it('vector RFC 3720: 32 bytes 0xFF → 0x62A8AB43', () => {
    expect(crc32c(Buffer.alloc(32, 0xff))).toBe(0x62a8ab43);
  });

  it('acepta Uint8Array', () => {
    expect(crc32c(new Uint8Array(Buffer.from('123456789', 'ascii')))).toBe(0xe3069283);
  });

  it('retorna unsigned (nunca negativo)', () => {
    // 'a' produce CRC con bit alto seteado en intermedios; el resultado
    // final debe ser >>> 0 (unsigned).
    const result = crc32c(Buffer.from('a'));
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(result)).toBe(true);
  });
});
