import { describe, expect, it } from 'vitest';
import { etaLine, formatEta, positionSourceLabel } from './live-tracking.js';

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

describe('etaLine', () => {
  it('con ETA la muestra; sin ETA degrada explícito', () => {
    expect(etaLine(42)).toBe('Llegada estimada: en 42 min');
    expect(etaLine(null)).toBe('Llegada estimada: no disponible aún');
    expect(etaLine(undefined)).toBe('Llegada estimada: no disponible aún');
  });
});
