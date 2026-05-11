import { describe, expect, it } from 'vitest';
import { calcularEstadoDocumento } from '../../src/services/compliance-estado.js';

const NOW = new Date('2026-05-11T10:00:00Z');

describe('calcularEstadoDocumento', () => {
  it('sin fecha de vencimiento → vigente', () => {
    expect(calcularEstadoDocumento(null, NOW)).toBe('vigente');
  });

  it('vencido (1 día atrás) → vencido', () => {
    expect(calcularEstadoDocumento(new Date('2026-05-10T00:00:00Z'), NOW)).toBe('vencido');
  });

  it('vence hoy mismo (0 días) → por_vencer (no vencido todavía)', () => {
    expect(calcularEstadoDocumento(new Date('2026-05-11T00:00:00Z'), NOW)).toBe('por_vencer');
  });

  it('vence en 30 días → por_vencer (threshold default)', () => {
    expect(calcularEstadoDocumento(new Date('2026-06-10T00:00:00Z'), NOW)).toBe('por_vencer');
  });

  it('vence en 31 días → vigente', () => {
    expect(calcularEstadoDocumento(new Date('2026-06-11T00:00:00Z'), NOW)).toBe('vigente');
  });

  it('vence en 1 año → vigente', () => {
    expect(calcularEstadoDocumento(new Date('2027-05-11T00:00:00Z'), NOW)).toBe('vigente');
  });

  it('threshold custom 7 días — vence en 10 → vigente', () => {
    expect(calcularEstadoDocumento(new Date('2026-05-21T00:00:00Z'), NOW, 7)).toBe('vigente');
  });

  it('threshold custom 7 días — vence en 5 → por_vencer', () => {
    expect(calcularEstadoDocumento(new Date('2026-05-16T00:00:00Z'), NOW, 7)).toBe('por_vencer');
  });

  it('comparación por día (ignora hora del día)', () => {
    // Vencimiento 18:00 del día actual, NOW 10:00 → sigue siendo "hoy" → por_vencer.
    const expiryToday = new Date('2026-05-11T18:00:00Z');
    expect(calcularEstadoDocumento(expiryToday, NOW)).toBe('por_vencer');
  });
});
