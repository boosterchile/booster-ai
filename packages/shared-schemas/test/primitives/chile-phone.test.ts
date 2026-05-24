import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/primitives/chile.js';

describe('normalizePhone — happy paths (plan T2 acceptance)', () => {
  it('móvil con spaces y prefix internacional → E.164', () => {
    expect(normalizePhone('+56 9 1234 5678')).toBe('+56912345678');
  });

  it('9-digit móvil sin prefix → prepend +56', () => {
    expect(normalizePhone('912345678')).toBe('+56912345678');
  });

  it('11-digit con 56 sin + → prepend +', () => {
    expect(normalizePhone('56912345678')).toBe('+56912345678');
  });

  it('móvil con dashes → strip + E.164', () => {
    expect(normalizePhone('+56-9-1234-5678')).toBe('+56912345678');
  });

  it('móvil con parens → strip + E.164', () => {
    expect(normalizePhone('+56 (9) 12345678')).toBe('+56912345678');
  });

  it('input ya E.164 canónico → returns as-is', () => {
    expect(normalizePhone('+56912345678')).toBe('+56912345678');
  });
});

describe('normalizePhone — fijo (landline) variants', () => {
  it('fijo Santiago 11-char E.164 → returns as-is', () => {
    // +56 + 8 dígitos comenzando con [2-9]
    expect(normalizePhone('+5621234567')).toBe('+5621234567');
  });

  it('fijo con spaces y dashes → normaliza', () => {
    expect(normalizePhone('+56 2 1234-567')).toBe('+5621234567');
  });
});

describe('normalizePhone — null returns (invalid inputs)', () => {
  it('texto que no es phone → null', () => {
    expect(normalizePhone('not-a-phone')).toBeNull();
  });

  it('prefix inválido `1` (no en [2-9]) → null', () => {
    expect(normalizePhone('+56 1 2345678')).toBeNull();
  });

  it('empty string → null', () => {
    expect(normalizePhone('')).toBeNull();
  });

  it('demasiado corto (< 8 dígitos post-prefix) → null', () => {
    expect(normalizePhone('+56912')).toBeNull();
  });

  it('demasiado largo (> 9 dígitos post-prefix) → null', () => {
    expect(normalizePhone('+5691234567890')).toBeNull();
  });

  it('9-digit que NO start-with-9 ni con prefix → null', () => {
    // 212345678 — Santiago landline sin prefix; plan T2 explicito no maneja este caso
    expect(normalizePhone('212345678')).toBeNull();
  });

  it('phone internacional no-Chile → null', () => {
    expect(normalizePhone('+1 234 567 8900')).toBeNull();
  });
});

describe('normalizePhone — idempotencia', () => {
  it('aplicar 2× al output no cambia', () => {
    const once = normalizePhone('+56 9 1234 5678');
    expect(once).toBe('+56912345678');
    const twice = normalizePhone(once ?? '');
    expect(twice).toBe('+56912345678');
  });
});
