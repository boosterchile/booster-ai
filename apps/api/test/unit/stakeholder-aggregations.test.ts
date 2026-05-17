import { describe, expect, it, vi } from 'vitest';
import {
  type ViajeAgregable,
  agregarPorHoraDelDia,
  calcularHorarioPico,
} from '../../src/services/stakeholder-aggregations.js';

const mk = (iso: string, actual?: number | null, estimated?: number | null): ViajeAgregable => ({
  pickup_at: new Date(iso),
  carbon_emissions_kgco2e_actual: actual ?? null,
  carbon_emissions_kgco2e_estimated: estimated ?? null,
});
const repeat = (n: number, fn: () => ViajeAgregable) => Array.from({ length: n }, fn);

describe('agregarPorHoraDelDia', () => {
  it('cero viajes → 24 entries con viajes=0 y co2e=0', () => {
    const r = agregarPorHoraDelDia([]);
    expect(r).toHaveLength(24);
    expect(r.every((b, i) => b.hora === i && b.viajes === 0 && b.co2e_kg === 0)).toBe(true);
  });

  it('exactamente k=5 a la misma hora suma CO2e usando actual', () => {
    expect(agregarPorHoraDelDia(repeat(5, () => mk('2026-05-17T10:00:00Z', 50)))[6]).toEqual({
      hora: 6,
      viajes: 5,
      co2e_kg: 250,
    });
  });

  it('k+1: fallback estimated cuando actual null + warn cuando ambos null', () => {
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    const viajes = [
      ...repeat(5, () => mk('2026-05-17T10:00:00Z', 50)),
      mk('2026-05-17T10:00:00Z', null, 40),
      mk('2026-05-17T10:00:00Z'),
    ];
    expect(agregarPorHoraDelDia(viajes, logger)[6]).toEqual({ hora: 6, viajes: 7, co2e_kg: 290 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('distribución bimodal: dos picos en horas distintas', () => {
    const viajes = [
      ...repeat(3, () => mk('2026-05-17T12:00:00Z', 30)),
      ...repeat(3, () => mk('2026-05-17T22:00:00Z', 30)),
    ];
    const r = agregarPorHoraDelDia(viajes);
    expect(r[8].viajes).toBe(3); // 12 UTC = 8 CL
    expect(r[18].viajes).toBe(3); // 22 UTC = 18 CL
  });
});

describe('calcularHorarioPico', () => {
  it('null cuando <5 viajes (k-anonymity)', () => {
    expect(calcularHorarioPico(repeat(4, () => mk('2026-05-17T12:00:00Z')))).toBeNull();
  });
  it('5 viajes a 8 CL → ventana 5..8 más temprana (12 UTC = 8 CL)', () => {
    const r = calcularHorarioPico(repeat(5, () => mk('2026-05-17T12:00:00Z')));
    expect(r).toEqual({ inicio: 5, fin: 8 });
  });
  it('pico claro vs ruido', () => {
    const viajes = [
      ...repeat(6, () => mk('2026-05-17T12:00:00Z')),
      ...repeat(2, () => mk('2026-05-17T02:00:00Z')),
    ];
    expect(calcularHorarioPico(viajes)).toEqual({ inicio: 5, fin: 8 });
  });
});
