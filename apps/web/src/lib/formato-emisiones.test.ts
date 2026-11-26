import { describe, expect, it } from 'vitest';
import {
  CO2E,
  formatoEmisiones,
  formatoFactorEmision,
  formatoIntensidad,
} from './formato-emisiones.js';

describe('formatoEmisiones', () => {
  it('escribe CO₂e con subíndice y siempre con unidad', () => {
    expect(CO2E).toBe('CO₂e');
    expect(formatoEmisiones(375.2)).toBe('375,2 kg CO₂e');
  });

  it('usa coma decimal y un decimal entre 1 kg y 1.000 kg', () => {
    expect(formatoEmisiones(1)).toBe('1,0 kg CO₂e');
    expect(formatoEmisiones(12.349)).toBe('12,3 kg CO₂e');
    expect(formatoEmisiones(999.94)).toBe('999,9 kg CO₂e');
  });

  it('usa tres decimales bajo 1 kg', () => {
    expect(formatoEmisiones(0.0344)).toBe('0,034 kg CO₂e');
    expect(formatoEmisiones(0.5)).toBe('0,500 kg CO₂e');
  });

  it('pasa a toneladas con dos decimales desde 1.000 kg', () => {
    expect(formatoEmisiones(1000)).toBe('1,00 t CO₂e');
    expect(formatoEmisiones(1254)).toBe('1,25 t CO₂e');
    expect(formatoEmisiones(287_400)).toBe('287,40 t CO₂e');
    expect(formatoEmisiones(1_234_567)).toBe('1.234,57 t CO₂e');
  });

  it('no deja un valor a caballo entre dos tramos', () => {
    expect(formatoEmisiones(999.96)).toBe('1,00 t CO₂e');
    expect(formatoEmisiones(0.9996)).toBe('1,0 kg CO₂e');
  });

  it('el cero no lleva decimales', () => {
    expect(formatoEmisiones(0)).toBe('0 kg CO₂e');
    expect(formatoEmisiones('0.000')).toBe('0 kg CO₂e');
  });

  it('acepta el texto numérico que entrega la API', () => {
    expect(formatoEmisiones('375.20')).toBe('375,2 kg CO₂e');
  });

  it('una reducción lleva el signo menos tipográfico', () => {
    expect(formatoEmisiones(-42.5)).toBe('−42,5 kg CO₂e');
  });

  it('sin valor dice «Sin dato»', () => {
    expect(formatoEmisiones(null)).toBe('Sin dato');
    expect(formatoEmisiones(undefined)).toBe('Sin dato');
    expect(formatoEmisiones('')).toBe('Sin dato');
    expect(formatoEmisiones('abc')).toBe('Sin dato');
    expect(formatoEmisiones(Number.NaN)).toBe('Sin dato');
  });
});

describe('formatoIntensidad', () => {
  it('gramos por tonelada-kilómetro, sin decimales', () => {
    expect(formatoIntensidad(62.4)).toBe('62 g CO₂e/t·km');
    expect(formatoIntensidad(1234.5)).toBe('1.235 g CO₂e/t·km');
    expect(formatoIntensidad(null)).toBe('Sin dato');
  });
});

describe('formatoFactorEmision', () => {
  it('kilogramos por litro, con dos decimales', () => {
    expect(formatoFactorEmision(2.68)).toBe('2,68 kg CO₂e/L');
    expect(formatoFactorEmision(2.3)).toBe('2,30 kg CO₂e/L');
  });
});
