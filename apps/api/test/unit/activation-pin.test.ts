import { describe, expect, it } from 'vitest';
import {
  generateActivationPin,
  hashActivationPin,
  verifyActivationPin,
} from '../../src/services/activation-pin.js';

describe('generateActivationPin', () => {
  it('siempre devuelve string de 6 caracteres', () => {
    for (let i = 0; i < 50; i += 1) {
      const pin = generateActivationPin();
      expect(pin).toHaveLength(6);
      expect(pin).toMatch(/^\d{6}$/);
    }
  });

  it('genera valores distintos (no es constante)', () => {
    const pins = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      pins.add(generateActivationPin());
    }
    // 20 PINs random sobre 10^6 — la chance de colisión total es despreciable.
    expect(pins.size).toBeGreaterThan(15);
  });
});

describe('hashActivationPin', () => {
  it('produce hashes distintos para el mismo PIN (salt distinto)', () => {
    const a = hashActivationPin('123456');
    const b = hashActivationPin('123456');
    expect(a).not.toBe(b);
  });

  it('formato: 6 partes separadas por $', () => {
    const h = hashActivationPin('123456');
    const parts = h.split('$');
    expect(parts).toHaveLength(6);
    // salt + N + r + p + keyLen + derived
  });
});

describe('verifyActivationPin', () => {
  it('verifica PIN correcto contra su propio hash', () => {
    const pin = '042197';
    const h = hashActivationPin(pin);
    expect(verifyActivationPin(pin, h)).toBe(true);
  });

  it('rechaza PIN incorrecto', () => {
    const h = hashActivationPin('123456');
    expect(verifyActivationPin('000000', h)).toBe(false);
    expect(verifyActivationPin('1234567', h)).toBe(false);
    expect(verifyActivationPin('', h)).toBe(false);
  });

  it('rechaza hash malformado (formato corrupto)', () => {
    expect(verifyActivationPin('123456', 'no-es-un-hash')).toBe(false);
    expect(verifyActivationPin('123456', 'parte1$parte2')).toBe(false);
    expect(verifyActivationPin('123456', 'a$b$c$d$e$f')).toBe(false);
  });

  it('rechaza hash con keyLen distinto al derived', () => {
    // Hash con keyLen=64 pero derived hex de 8 chars (4 bytes) → mismatch
    const corrupt = `${'ab'.repeat(16)}$16384$8$1$64$deadbeef`;
    expect(verifyActivationPin('123456', corrupt)).toBe(false);
  });

  it('roundtrip con PINs de varios formatos', () => {
    for (const pin of ['000000', '999999', '042197', '111111']) {
      const h = hashActivationPin(pin);
      expect(verifyActivationPin(pin, h)).toBe(true);
    }
  });
});
