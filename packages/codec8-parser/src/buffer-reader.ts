import { CodecParseError } from './tipos.js';

/**
 * Reader secuencial sobre un Buffer con tracking de offset.
 *
 * Diseño minimalista — no es una abstracción de stream completa, solo
 * un cursor que avanza sobre un Buffer ya recibido (un AVL packet
 * completo). Todos los reads son big-endian (Codec 8 spec).
 *
 * Validación: antes de cada read chequea que haya bytes suficientes;
 * si no, tira CodecParseError con offset actual para diagnóstico.
 */
export class BufferReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.buf.length) {
      throw new CodecParseError(
        `BufferReader: necesita ${n} bytes pero hay ${this.remaining} restantes`,
        this.offset,
      );
    }
  }

  readUInt8(): number {
    this.ensure(1);
    const v = this.buf.readUInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readInt8(): number {
    this.ensure(1);
    const v = this.buf.readInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUInt16BE(): number {
    this.ensure(2);
    const v = this.buf.readUInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  readInt16BE(): number {
    this.ensure(2);
    const v = this.buf.readInt16BE(this.offset);
    this.offset += 2;
    return v;
  }

  readUInt32BE(): number {
    this.ensure(4);
    const v = this.buf.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  readInt32BE(): number {
    this.ensure(4);
    const v = this.buf.readInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  readBigUInt64BE(): bigint {
    this.ensure(8);
    const v = this.buf.readBigUInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  readBigInt64BE(): bigint {
    this.ensure(8);
    const v = this.buf.readBigInt64BE(this.offset);
    this.offset += 8;
    return v;
  }

  readBytes(n: number): Buffer {
    this.ensure(n);
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    // subarray comparte memoria con this.buf — copiamos para que el
    // caller pueda mutarlo o conservarlo después de que se libere this.buf.
    return Buffer.from(slice);
  }

  /**
   * Avanza el cursor n bytes sin leer (útil para skip de campos).
   */
  skip(n: number): void {
    this.ensure(n);
    this.offset += n;
  }
}
