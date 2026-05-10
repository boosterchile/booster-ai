import { describe, expect, it } from 'vitest';
import { estimarDistanciaKm } from '../../src/services/estimar-distancia.js';

describe('estimarDistanciaKm', () => {
  it('null origen retorna default 500', () => {
    expect(estimarDistanciaKm(null, 'RM')).toBe(500);
  });

  it('null destino retorna default 500', () => {
    expect(estimarDistanciaKm('RM', null)).toBe(500);
  });

  it('ambos null retorna default 500', () => {
    expect(estimarDistanciaKm(null, null)).toBe(500);
  });

  it('mismo código de región retorna intra-regional 30 km', () => {
    expect(estimarDistanciaKm('RM', 'RM')).toBe(30);
    expect(estimarDistanciaKm('II', 'II')).toBe(30);
    expect(estimarDistanciaKm('XII', 'XII')).toBe(30);
  });

  it('case-insensitive en input', () => {
    expect(estimarDistanciaKm('rm', 'RM')).toBe(30);
    expect(estimarDistanciaKm('Rm', 'rm')).toBe(30);
  });

  it('lookup canónico Santiago→Valparaíso (RM→V)', () => {
    expect(estimarDistanciaKm('RM', 'V')).toBeGreaterThan(0);
    expect(estimarDistanciaKm('RM', 'V')).toBeLessThan(200); // valor real ~115km
  });

  it('lookup simétrico V→RM funciona via filaInversa', () => {
    const ab = estimarDistanciaKm('RM', 'V');
    const ba = estimarDistanciaKm('V', 'RM');
    expect(ab).toBe(ba);
  });

  it('lookup canónico extremos del país (XV→XII) > 5000 km', () => {
    expect(estimarDistanciaKm('XV', 'XII')).toBeGreaterThan(5000);
  });

  it('código de región desconocido retorna default 500', () => {
    expect(estimarDistanciaKm('FOO', 'BAR')).toBe(500);
    expect(estimarDistanciaKm('RM', 'NOT_A_REGION')).toBe(500);
  });

  it('retorna número entero (no float)', () => {
    const result = estimarDistanciaKm('VIII', 'IX');
    expect(Number.isInteger(result)).toBe(true);
  });

  it('todas las distancias inter-regionales son positivas', () => {
    const regiones = [
      'XV',
      'I',
      'II',
      'III',
      'IV',
      'V',
      'RM',
      'VI',
      'VII',
      'XVI',
      'VIII',
      'IX',
      'XIV',
      'X',
      'XI',
      'XII',
    ];
    for (const o of regiones) {
      for (const d of regiones) {
        const dist = estimarDistanciaKm(o, d);
        expect(dist).toBeGreaterThan(0);
      }
    }
  });
});
