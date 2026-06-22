import { describe, expect, it } from 'vitest';
import { generateActivationPin, hashActivationPin, verifyActivationPin } from './activation-pin.js';

/**
 * Dominio crítico (auth): el PIN de activación de conductor debe ser
 * uniforme. Un sesgo del módulo hace que ciertos PINs sean más probables,
 * lo que reduce la entropía efectiva frente a brute-force. CodeQL
 * `js/biased-cryptographic-random` (alert #91) marcaba el módulo sobre
 * un random criptográfico en este archivo.
 *
 * Tests de comportamiento de negocio:
 *   1. Contrato del PIN: siempre 6 dígitos numéricos, rango [0, 999999].
 *   2. Charset completo: cada posición alcanza los 10 dígitos (0-9).
 *   3. Sin sesgo: rejection sampling descarta el bloque parcial superior
 *      del espacio de bytes que causaría el sesgo del módulo.
 */

describe('generateActivationPin — contrato del PIN', () => {
  it('siempre devuelve exactamente 6 caracteres numéricos', () => {
    for (let i = 0; i < 2_000; i++) {
      const pin = generateActivationPin();
      expect(pin).toMatch(/^[0-9]{6}$/);
    }
  });

  it('el valor numérico siempre cae en el rango [0, 999999]', () => {
    for (let i = 0; i < 2_000; i++) {
      const pin = generateActivationPin();
      const n = Number.parseInt(pin, 10);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(999_999);
    }
  });

  it('todos los dígitos 0-9 son alcanzables en cada una de las 6 posiciones', () => {
    // Sin shrink de charset: con suficientes muestras, cada posición debe
    // exhibir los 10 dígitos. Si la implementación recortara el rango,
    // alguna posición no alcanzaría todos los dígitos.
    const seen: Array<Set<string>> = Array.from({ length: 6 }, () => new Set<string>());
    for (let i = 0; i < 20_000; i++) {
      const pin = generateActivationPin();
      for (let pos = 0; pos < 6; pos++) {
        seen[pos]?.add(pin[pos] as string);
      }
    }
    for (let pos = 0; pos < 6; pos++) {
      expect(seen[pos]?.size).toBe(10);
    }
  });
});

describe('generateActivationPin — sin sesgo del módulo (rejection sampling)', () => {
  // randomBytes(4) produce un uint32 en [0, 2^32). Tomar `% 1_000_000`
  // sesga los valores menores a (2^32 mod 1_000_000) porque reciben un
  // conteo extra. La corrección uniforme rechaza el bloque parcial
  // superior: el mayor múltiplo de 1_000_000 que cabe en 2^32 es
  // floor(2^32 / 1_000_000) * 1_000_000 = 4_294 * 1_000_000 = 4_294_000_000.
  // Cualquier sample >= ese límite debe re-muestrearse.
  const REJECTION_THRESHOLD = 4_294_000_000;

  function bytesFromUint32(value: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(value >>> 0, 0);
    return b;
  }

  it('acepta un sample bajo el umbral y lo mapea con módulo', () => {
    // 123_456 está muy por debajo del umbral → se acepta directo.
    const pin = generateActivationPin(() => bytesFromUint32(123_456));
    expect(pin).toBe('123456');
  });

  it('descarta el sample sesgado (>= umbral) y re-muestrea hasta uno válido', () => {
    // Primer sample en la zona sesgada (>= umbral) → debe descartarse.
    // Segundo sample válido → debe usarse. Si la implementación NO
    // rechazara, devolvería (umbral % 1_000_000) en vez de re-muestrear.
    const samples = [bytesFromUint32(REJECTION_THRESHOLD), bytesFromUint32(777_777)];
    let call = 0;
    const pin = generateActivationPin(() => {
      const next = samples[call] ?? bytesFromUint32(0);
      call += 1;
      return next;
    });
    expect(pin).toBe('777777');
    expect(call).toBe(2); // confirmó que descartó el primero y tomó el segundo
  });

  it('un sample exactamente en el último valor válido (umbral - 1) se acepta', () => {
    const lastValid = REJECTION_THRESHOLD - 1; // 4_293_999_999
    const pin = generateActivationPin(() => bytesFromUint32(lastValid));
    // 4_293_999_999 % 1_000_000 = 999_999
    expect(pin).toBe('999999');
  });
});

describe('hashActivationPin / verifyActivationPin — round-trip', () => {
  it('verifica un PIN correcto contra su hash', () => {
    const pin = generateActivationPin();
    const hash = hashActivationPin(pin);
    expect(verifyActivationPin(pin, hash)).toBe(true);
  });

  it('rechaza un PIN incorrecto', () => {
    const hash = hashActivationPin('123456');
    expect(verifyActivationPin('654321', hash)).toBe(false);
  });

  it('rechaza un hash con formato inválido sin lanzar', () => {
    expect(verifyActivationPin('123456', 'no-es-un-hash')).toBe(false);
  });
});
