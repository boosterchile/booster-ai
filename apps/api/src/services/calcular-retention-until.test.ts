import { describe, expect, it } from 'vitest';
import { calcularRetentionUntil } from './calcular-retention-until.js';

describe('calcularRetentionUntil', () => {
  it('con fecha_emision → fecha_emision + 6 años (ISO date)', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '2026-06-15',
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-15');
    expect(r.needsReview).toBe(false);
  });

  it('sin fecha_emision → created_at + 6 años + marca de revisión', () => {
    const r = calcularRetentionUntil({
      fechaEmision: null,
      createdAt: new Date('2026-06-18T10:00:00.000Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-18');
    expect(r.needsReview).toBe(true);
  });

  it('maneja año bisiesto (29-feb → 28-feb a +6a no bisiesto preserva mes/día válido)', () => {
    // 2024-02-29 + 6a = 2030-02-28 (2030 no bisiesto). El cálculo debe
    // producir una fecha válida, no 2030-02-29 (inexistente) ni overflow a marzo.
    const r = calcularRetentionUntil({
      fechaEmision: '2024-02-29',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
    });
    expect(r.retentionUntil).toBe('2030-02-28');
  });

  it('fecha_emision string vacío se trata como ausente (fallback)', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(r.retentionUntil).toBe('2032-01-01');
    expect(r.needsReview).toBe(true);
  });
});
