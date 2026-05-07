import { describe, expect, it } from 'vitest';
import { skipNetworkPings } from '../src/connection-handler.js';

describe('skipNetworkPings — Wave 2 G2.1', () => {
  it('retorna el mismo buffer si está vacío', () => {
    const buf = Buffer.alloc(0);
    expect(skipNetworkPings(buf)).toBe(buf);
  });

  it('retorna el mismo buffer si no empieza con 0xFF', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x12, 0x34]);
    const result = skipNetworkPings(buf);
    expect(result).toBe(buf);
    expect(result.equals(buf)).toBe(true);
  });

  it('descarta un solo byte 0xFF aislado', () => {
    const buf = Buffer.from([0xff]);
    expect(skipNetworkPings(buf).length).toBe(0);
  });

  it('descarta múltiples 0xFF consecutivos', () => {
    const buf = Buffer.from([0xff, 0xff, 0xff, 0xff]);
    expect(skipNetworkPings(buf).length).toBe(0);
  });

  it('descarta 0xFF al inicio y conserva el resto del buffer', () => {
    const avlPreamble = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x18]);
    const buf = Buffer.concat([Buffer.from([0xff, 0xff]), avlPreamble]);
    const result = skipNetworkPings(buf);
    expect(result.length).toBe(avlPreamble.length);
    expect(result.equals(avlPreamble)).toBe(true);
  });

  it('NO descarta 0xFF en medio del buffer (solo al inicio)', () => {
    // Caso patológico defensivo: si por alguna razón un byte 0xFF aparece
    // dentro del payload de un AVL, no debe ser interpretado como ping.
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x12]);
    const result = skipNetworkPings(buf);
    expect(result).toBe(buf);
  });

  it('NO descarta 0xFE u otros bytes parecidos', () => {
    const buf = Buffer.from([0xfe, 0x00, 0x00, 0x00]);
    const result = skipNetworkPings(buf);
    expect(result).toBe(buf);
  });

  it('handles long ping streams without exhausting memory', () => {
    // Edge case: si el device queda atascado mandando solo pings (raro
    // pero posible en jitter de red), la función debe terminar en O(n).
    const buf = Buffer.alloc(10_000, 0xff);
    expect(skipNetworkPings(buf).length).toBe(0);
  });

  it('preserva referencia al buffer original cuando no hay pings (zero-copy)', () => {
    // Optimización: si no hay 0xFF al inicio, evitamos la copia. Esto
    // importa porque skipNetworkPings se llama en cada iteración del
    // loop principal del processBuffer.
    const buf = Buffer.from([0x00, 0x12, 0x34]);
    expect(skipNetworkPings(buf)).toBe(buf);
  });
});
