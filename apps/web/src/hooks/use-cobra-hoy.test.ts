import { describe, expect, it } from 'vitest';
import { esCobraHoyApagado } from './use-cobra-hoy.js';

const COTIZACION = {
  monto_neto_clp: 176000,
  plazo_dias_shipper: 30,
  tarifa_pct: 1.5,
  tarifa_clp: 2640,
  monto_adelantado_clp: 173360,
};

describe('esCobraHoyApagado', () => {
  it('la cotización apagada es enabled false con items vacío', () => {
    expect(esCobraHoyApagado({ enabled: false, items: [] })).toBe(true);
  });

  it('una cotización real no es el sobre apagado', () => {
    expect(esCobraHoyApagado(COTIZACION)).toBe(false);
  });

  it('items con filas no cuenta como cotización apagada', () => {
    expect(esCobraHoyApagado({ enabled: false, items: [COTIZACION] })).toBe(false);
  });
});
