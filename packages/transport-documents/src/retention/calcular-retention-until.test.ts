import { describe, expect, it } from 'vitest';
import { calcularRetentionUntil } from './calcular-retention-until.js';

/**
 * Política de custodia del archivador (ADR-070, spec O-3): 6 años desde
 * `fecha_emision`; fallback `created_at + 6a` con marca de revisión.
 * Dominio crítico — un cálculo errado puede provocar borrado prematuro de un
 * documento tributario o retención incorrecta.
 */
describe('calcularRetentionUntil — política de custodia 6 años (ADR-070)', () => {
  it('con fecha_emision → retention_until = fecha_emision + 6 años', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '2026-06-11',
      createdAt: new Date('2026-06-18T12:00:00Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-11');
    expect(r.needsReview).toBe(false);
  });

  it('sin fecha_emision (null) → fallback created_at + 6 años + marca de revisión', () => {
    const r = calcularRetentionUntil({
      fechaEmision: null,
      createdAt: new Date('2026-06-18T12:00:00Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-18');
    expect(r.needsReview).toBe(true);
  });

  it('fecha vacía/whitespace → fallback con marca de revisión', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '   ',
      createdAt: new Date('2026-06-18T00:00:00Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-18');
    expect(r.needsReview).toBe(true);
  });

  it('29-feb (bisiesto) +6a → clampea a 28-feb del año destino no bisiesto', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '2024-02-29',
      createdAt: new Date('2024-02-29T00:00:00Z'),
    });
    expect(r.retentionUntil).toBe('2030-02-28');
    expect(r.needsReview).toBe(false);
  });

  it('fecha no ISO (formato inválido) → fallback (no parsea como fecha real)', () => {
    const r = calcularRetentionUntil({
      fechaEmision: '11-06-2026',
      createdAt: new Date('2026-06-18T00:00:00Z'),
    });
    expect(r.retentionUntil).toBe('2032-06-18');
    expect(r.needsReview).toBe(true);
  });
});
