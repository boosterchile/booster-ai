import { describe, expect, it } from 'vitest';
import { formatRutForDisplay, normalizeRut, rutSchema } from '../../src/primitives/chile.js';

describe('normalizeRut', () => {
  it('quita puntos manteniendo el guión', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
  });

  it('uppercase del dígito verificador K', () => {
    expect(normalizeRut('12345678-k')).toBe('12345678-K');
  });

  it('input ya canónico no cambia', () => {
    expect(normalizeRut('12345678-5')).toBe('12345678-5');
  });
});

describe('formatRutForDisplay', () => {
  it('agrega puntos al RUT canónico', () => {
    expect(formatRutForDisplay('12345678-5')).toBe('12.345.678-5');
  });

  it('RUT con K mayúscula se mantiene', () => {
    expect(formatRutForDisplay('77888222-K')).toBe('77.888.222-K');
  });

  it('input mal formado devuelve igual (defensivo)', () => {
    expect(formatRutForDisplay('no-es-un-rut')).toBe('no-es-un-rut');
  });
});

describe('rutSchema transform', () => {
  it('input con puntos → canónico sin puntos', () => {
    const parsed = rutSchema.parse('11.111.111-1');
    expect(parsed).toBe('11111111-1');
  });

  it('input sin puntos → canónico (idempotente)', () => {
    const parsed = rutSchema.parse('11111111-1');
    expect(parsed).toBe('11111111-1');
  });

  it('K minúscula → K mayúscula en canónico', () => {
    // RUT body 12345670 → DV = K (verificación módulo 11)
    const parsed = rutSchema.parse('12.345.670-k');
    expect(parsed).toBe('12345670-K');
  });

  it('dígito verificador inválido → throw', () => {
    expect(() => rutSchema.parse('11.111.111-9')).toThrow();
  });

  it('formato inválido → throw', () => {
    expect(() => rutSchema.parse('no-es-rut')).toThrow();
  });
});
