import { describe, expect, it } from 'vitest';
import {
  etaLine,
  formatEta,
  positionSourceLabel,
  publicTrackingShareUrl,
} from './live-tracking.js';

describe('positionSourceLabel', () => {
  it('nombra cada fuente y calla sin fuente', () => {
    expect(positionSourceLabel('teltonika')).toBe('Posición reportada por el GPS del vehículo');
    expect(positionSourceLabel('mobile')).toBe('Posición reportada por el teléfono del conductor');
    expect(positionSourceLabel(null)).toBeNull();
    expect(positionSourceLabel(undefined)).toBeNull();
  });
});

describe('formatEta', () => {
  it('minutos, horas y horas exactas', () => {
    expect(formatEta(12)).toBe('en 12 min');
    expect(formatEta(59)).toBe('en 59 min');
    expect(formatEta(60)).toBe('en 1 h');
    expect(formatEta(95)).toBe('en 1 h 35 min');
  });

  it('nunca «en 0 min»: piso de 1, igual que el API', () => {
    expect(formatEta(0)).toBe('en 1 min');
    expect(formatEta(0.4)).toBe('en 1 min');
  });
});

describe('publicTrackingShareUrl', () => {
  const token = '550e8400-e29b-4114-a716-446655440000';
  const origin = 'https://app.boosterchile.com';

  it('en_proceso con token arma el enlace aunque no haya destinatario', () => {
    expect(publicTrackingShareUrl(token, 'en_proceso', origin)).toBe(`${origin}/tracking/${token}`);
    expect(publicTrackingShareUrl(token, 'asignado', `${origin}/`)).toBe(
      `${origin}/tracking/${token}`,
    );
  });

  it('sin token o fuera de seguimiento vivo no arma enlace', () => {
    expect(publicTrackingShareUrl(null, 'en_proceso', origin)).toBeNull();
    expect(publicTrackingShareUrl('', 'en_proceso', origin)).toBeNull();
    expect(publicTrackingShareUrl(token, 'entregado', origin)).toBeNull();
    expect(publicTrackingShareUrl(token, 'cancelado', origin)).toBeNull();
    expect(publicTrackingShareUrl(token, 'ofertas_enviadas', origin)).toBeNull();
  });
});

describe('etaLine', () => {
  it('con ETA la muestra; sin ETA degrada explícito', () => {
    expect(etaLine(42)).toBe('Llegada estimada: en 42 min');
    expect(etaLine(null)).toBe('Llegada estimada: no disponible aún');
    expect(etaLine(undefined)).toBe('Llegada estimada: no disponible aún');
  });
});
