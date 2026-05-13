import { describe, expect, it } from 'vitest';
import {
  hashClaveNumerica,
  isValidClaveFormat,
  verifyClaveNumerica,
} from '../../src/services/clave-numerica.js';

describe('clave-numerica service (ADR-035)', () => {
  describe('isValidClaveFormat', () => {
    it('acepta 6 dígitos exactos', () => {
      expect(isValidClaveFormat('123456')).toBe(true);
      expect(isValidClaveFormat('000000')).toBe(true);
    });
    it('rechaza < 6 dígitos', () => {
      expect(isValidClaveFormat('12345')).toBe(false);
    });
    it('rechaza > 6 dígitos', () => {
      expect(isValidClaveFormat('1234567')).toBe(false);
    });
    it('rechaza letras', () => {
      expect(isValidClaveFormat('abc123')).toBe(false);
      expect(isValidClaveFormat('12345a')).toBe(false);
    });
    it('rechaza string vacío', () => {
      expect(isValidClaveFormat('')).toBe(false);
    });
  });

  describe('hashClaveNumerica + verifyClaveNumerica round-trip', () => {
    it('hashea y verifica una clave correcta', () => {
      const hash = hashClaveNumerica('123456');
      expect(verifyClaveNumerica('123456', hash)).toBe(true);
    });

    it('rechaza clave incorrecta con el mismo hash', () => {
      const hash = hashClaveNumerica('123456');
      expect(verifyClaveNumerica('654321', hash)).toBe(false);
    });

    it('cada hash de la misma clave es distinto (salt aleatorio)', () => {
      const h1 = hashClaveNumerica('123456');
      const h2 = hashClaveNumerica('123456');
      expect(h1).not.toBe(h2);
    });

    it('formato del hash es `salt$N$r$p$keyLen$derived`', () => {
      const hash = hashClaveNumerica('111111');
      const parts = hash.split('$');
      expect(parts).toHaveLength(6);
      expect(Number.parseInt(parts[1] ?? '', 10)).toBe(2 ** 14);
      expect(Number.parseInt(parts[2] ?? '', 10)).toBe(8);
      expect(Number.parseInt(parts[3] ?? '', 10)).toBe(1);
      expect(Number.parseInt(parts[4] ?? '', 10)).toBe(64);
    });
  });

  describe('verifyClaveNumerica defensive', () => {
    it('hash corrupto (sin separadores) → false', () => {
      expect(verifyClaveNumerica('123456', 'no-es-un-hash-valido')).toBe(false);
    });

    it('hash con muy pocos campos → false', () => {
      expect(verifyClaveNumerica('123456', 'salt$N$r')).toBe(false);
    });

    it('hash con N no numérico → false', () => {
      expect(verifyClaveNumerica('123456', 'salt$notanum$8$1$64$derived')).toBe(false);
    });
  });
});
