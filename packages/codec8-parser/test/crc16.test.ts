import { describe, expect, it } from 'vitest';
import { crc16Ibm } from '../src/crc16.js';

describe('crc16Ibm', () => {
  // Vectores de referencia de https://crccalc.com con CRC-16/ARC (CRC-16/IBM).
  // Mismo algoritmo que Teltonika usa en el trailer de AVL packets.
  it('CRC-16/IBM de "123456789" = 0xBB3D', () => {
    expect(crc16Ibm(Buffer.from('123456789'))).toBe(0xbb3d);
  });

  it('CRC-16/IBM de string vacío = 0x0000', () => {
    expect(crc16Ibm(Buffer.alloc(0))).toBe(0x0000);
  });

  it('CRC-16/IBM de un único byte 0x00 = 0x0000', () => {
    expect(crc16Ibm(Buffer.from([0x00]))).toBe(0x0000);
  });

  it('CRC-16/IBM de un único byte 0xFF = 0x4040', () => {
    expect(crc16Ibm(Buffer.from([0xff]))).toBe(0x4040);
  });

  it('respeta el rango start/end', () => {
    const buf = Buffer.from('xx123456789yy');
    // Debe ignorar 'xx' y 'yy' y dar el mismo resultado que para "123456789"
    expect(crc16Ibm(buf, 2, 11)).toBe(0xbb3d);
  });
});
