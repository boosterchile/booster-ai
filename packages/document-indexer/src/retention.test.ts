import { describe, expect, it } from 'vitest';
import { LEGAL_RETENTION_YEARS, computeRetentionUntil, isLegallyRetained } from './retention.js';

describe('isLegallyRetained', () => {
  it('marca DTEs como retenidos', () => {
    expect(isLegallyRetained('dte_guia_despacho')).toBe(true);
    expect(isLegallyRetained('dte_factura')).toBe(true);
    expect(isLegallyRetained('dte_factura_exenta')).toBe(true);
  });

  it('marca carta de porte y acta como retenidos', () => {
    expect(isLegallyRetained('carta_porte')).toBe(true);
    expect(isLegallyRetained('acta_entrega')).toBe(true);
  });

  it('NO marca capturas operacionales', () => {
    expect(isLegallyRetained('foto_pickup')).toBe(false);
    expect(isLegallyRetained('foto_delivery')).toBe(false);
    expect(isLegallyRetained('checklist_vehiculo')).toBe(false);
  });

  it('NO marca documentos externos del usuario', () => {
    expect(isLegallyRetained('factura_externa')).toBe(false);
    expect(isLegallyRetained('comprobante_pago')).toBe(false);
  });
});

describe('computeRetentionUntil', () => {
  it('retorna null para tipos sin retention legal', () => {
    expect(
      computeRetentionUntil({ type: 'foto_pickup', emittedAt: '2026-05-04T00:00:00Z' }),
    ).toBeNull();
  });

  it('suma 6 años exactos para DTE Guía', () => {
    const result = computeRetentionUntil({
      type: 'dte_guia_despacho',
      emittedAt: '2026-05-04T00:00:00.000Z',
    });
    expect(result).toBe('2032-05-04T00:00:00.000Z');
  });

  it('respeta el LEGAL_RETENTION_YEARS', () => {
    expect(LEGAL_RETENTION_YEARS).toBe(6);
  });

  it('acepta Date input', () => {
    const result = computeRetentionUntil({
      type: 'carta_porte',
      emittedAt: new Date('2026-01-15T12:34:56.789Z'),
    });
    expect(result).toBe('2032-01-15T12:34:56.789Z');
  });
});
