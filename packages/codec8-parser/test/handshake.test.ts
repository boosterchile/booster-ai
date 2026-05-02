import { describe, expect, it } from 'vitest';
import { encodeImeiAck, parseImeiHandshake } from '../src/handshake.js';
import { CodecParseError } from '../src/tipos.js';

describe('parseImeiHandshake', () => {
  it('parsea IMEI estándar de 15 dígitos (spec wiki Teltonika)', () => {
    // Ejemplo de la spec pública: IMEI = "356307042441013"
    // Hex: 000F  3 5 6 3 0 7 0 4 2 4 4 1 0 1 3
    //      0x33 = '3', etc.
    const buf = Buffer.from([
      0x00, 0x0f, // length = 15
      0x33, 0x35, 0x36, 0x33, 0x30, 0x37, 0x30, 0x34, 0x32, 0x34, 0x34, 0x31, 0x30, 0x31, 0x33,
    ]);
    const { imei } = parseImeiHandshake(buf);
    expect(imei).toBe('356307042441013');
    expect(imei).toHaveLength(15);
  });

  it('rechaza length fuera de rango (< 8)', () => {
    const buf = Buffer.from([0x00, 0x05, 0x31, 0x32, 0x33, 0x34, 0x35]);
    expect(() => parseImeiHandshake(buf)).toThrow(CodecParseError);
  });

  it('rechaza length fuera de rango (> 20)', () => {
    const buf = Buffer.from([0x00, 0x21]); // length = 33
    expect(() => parseImeiHandshake(buf)).toThrow(CodecParseError);
  });

  it('rechaza IMEI con caracteres no numéricos', () => {
    const buf = Buffer.from([
      0x00, 0x0f,
      0x33, 0x35, 0x36, 0x33, 0x30, 0x37, 0x30, 0x34, 0x32, 0x34, 0x34, 0x41, 0x30, 0x31, 0x33,
      // ───────────────────────────────────────────────────────^^^ 'A' = 0x41 (no numérico)
    ]);
    expect(() => parseImeiHandshake(buf)).toThrow(/no es ASCII numérico/);
  });

  it('rechaza buffer truncado (length declarada > bytes disponibles)', () => {
    const buf = Buffer.from([0x00, 0x0f, 0x33, 0x35]); // dice 15 pero solo hay 2
    expect(() => parseImeiHandshake(buf)).toThrow(CodecParseError);
  });
});

describe('encodeImeiAck', () => {
  it('emite 0x01 cuando se acepta', () => {
    expect(encodeImeiAck(true)).toEqual(Buffer.from([0x01]));
  });

  it('emite 0x00 cuando se rechaza', () => {
    expect(encodeImeiAck(false)).toEqual(Buffer.from([0x00]));
  });
});
