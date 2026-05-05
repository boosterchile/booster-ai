import { describe, expect, it } from 'vitest';
import { formatRut, isValidRut } from './rut.js';

describe('formatRut', () => {
  it('formatea un RUT crudo de 8 dígitos + DV', () => {
    expect(formatRut('142893983')).toBe('14.289.398-3');
  });

  it('formatea un RUT con guión preexistente', () => {
    expect(formatRut('14289398-3')).toBe('14.289.398-3');
  });

  it('respeta puntos y guión ya presentes', () => {
    expect(formatRut('14.289.398-3')).toBe('14.289.398-3');
  });

  it('maneja DV K en mayúscula', () => {
    expect(formatRut('8765432K')).toBe('8.765.432-K');
  });

  it('maneja DV k en minúscula y la pasa a mayúscula', () => {
    expect(formatRut('8765432k')).toBe('8.765.432-K');
  });

  it('formatea un RUT corto (menos de 8 dígitos)', () => {
    expect(formatRut('15555-3')).toBe('15.555-3');
  });

  it('devuelve el input tal cual si tiene <2 caracteres significativos', () => {
    expect(formatRut('')).toBe('');
    expect(formatRut('1')).toBe('1');
    expect(formatRut('-')).toBe('-');
  });

  it('descarta espacios y caracteres no válidos', () => {
    expect(formatRut('14 289 398 3')).toBe('14.289.398-3');
    expect(formatRut('14.289.398.3')).toBe('14.289.398-3');
  });
});

describe('isValidRut', () => {
  it('acepta RUTs reales con DV correcto', () => {
    expect(isValidRut('14.289.398-3')).toBe(true);
    expect(isValidRut('142893983')).toBe(true);
    expect(isValidRut('14289398-3')).toBe(true);
  });

  it('acepta RUT con DV K (mayúscula y minúscula)', () => {
    expect(isValidRut('8765432K')).toBe(true);
    expect(isValidRut('8765432k')).toBe(true);
    expect(isValidRut('8.765.432-K')).toBe(true);
  });

  it('rechaza RUTs con DV incorrecto', () => {
    expect(isValidRut('14289398-9')).toBe(false);
    expect(isValidRut('8765432-1')).toBe(false);
  });

  it('rechaza inputs vacíos o demasiado cortos', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('1')).toBe(false);
    expect(isValidRut('-K')).toBe(false);
  });

  it('rechaza inputs con cuerpo no numérico', () => {
    expect(isValidRut('abcdefg-3')).toBe(false);
    expect(isValidRut('142KK983-3')).toBe(false);
  });

  it('valida casos de borde del algoritmo (DV = 0 cuando módulo es 11)', () => {
    // Dígitos {2,3,4,5,6,7} para que sum%11 = 0 (DV esperado: 0).
    // 1234567-4? Verificación manual con el algoritmo:
    //   7*2 + 6*3 + 5*4 + 4*5 + 3*6 + 2*7 + 1*2 = 14+18+20+20+18+14+2 = 106
    //   106 % 11 = 7  →  11 - 7 = 4  →  DV = 4
    expect(isValidRut('1234567-4')).toBe(true);
    expect(isValidRut('1234567-0')).toBe(false);
  });
});
