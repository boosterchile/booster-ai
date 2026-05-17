import { describe, expect, it, vi } from 'vitest';
import {
  type ViajeAgregable,
  agregarPorCombustible,
  agregarPorHoraDelDia,
  agregarPorTipoCarga,
  calcularHorarioPico,
  puntoEnBoundingBox,
} from '../../src/services/stakeholder-aggregations.js';

const mk = (
  iso: string,
  actual?: number | null,
  estimated?: number | null,
  tipo_carga: ViajeAgregable['tipo_carga'] = 'carga_seca',
  fuel_type: ViajeAgregable['fuel_type'] = 'diesel',
): ViajeAgregable => ({
  pickup_at: new Date(iso),
  tipo_carga,
  fuel_type,
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

describe('agregarPorTipoCarga', () => {
  it('vacío → []', () => {
    expect(agregarPorTipoCarga([])).toEqual([]);
  });
  it('suma CO2e por tipo; fallback estimated y warn cuando ambos null', () => {
    const warn = vi.fn();
    const logger = { warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } as never;
    const viajes = [
      mk('2026-05-17T12:00:00Z', 100, null, 'carga_seca'),
      mk('2026-05-17T12:00:00Z', null, 50, 'carga_seca'),
      mk('2026-05-17T12:00:00Z', null, null, 'carga_seca'), // warn, no suma
      mk('2026-05-17T12:00:00Z', 200, null, 'refrigerada'),
    ];
    const r = agregarPorTipoCarga(viajes, logger);
    const seca = r.find((b) => b.tipo === 'carga_seca');
    const refr = r.find((b) => b.tipo === 'refrigerada');
    expect(seca).toEqual({ tipo: 'carga_seca', viajes: 3, co2e_kg: 150 });
    expect(refr).toEqual({ tipo: 'refrigerada', viajes: 1, co2e_kg: 200 });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('puntoEnBoundingBox', () => {
  // Bbox Puerto Valparaíso (mismo que migration 0034).
  const zona = { lat_min: -33.0501, lat_max: -33.0252, lng_min: -71.645, lng_max: -71.61 };

  it('dentro del bbox → true', () => {
    expect(puntoEnBoundingBox({ lat: -33.04, lng: -71.62 }, zona)).toBe(true);
  });
  it('fuera del bbox (lat menor que lat_min) → false', () => {
    expect(puntoEnBoundingBox({ lat: -33.1, lng: -71.62 }, zona)).toBe(false);
  });
  it('en el borde lat=lat_min y lng=lng_max → true (inclusivo)', () => {
    expect(puntoEnBoundingBox({ lat: -33.0501, lng: -71.61 }, zona)).toBe(true);
  });
  it('bbox invertido (defensive) → false', () => {
    expect(
      puntoEnBoundingBox(
        { lat: -33.04, lng: -71.62 },
        { lat_min: -33.0, lat_max: -33.1, lng_min: -71.6, lng_max: -71.7 },
      ),
    ).toBe(false);
  });
});

describe('agregarPorCombustible', () => {
  it('vacío → []', () => {
    expect(agregarPorCombustible([])).toEqual([]);
  });
  it('agrupa por fuel_type', () => {
    const viajes = [
      mk('2026-05-17T12:00:00Z', 100, null, 'carga_seca', 'diesel'),
      mk('2026-05-17T12:00:00Z', 80, null, 'carga_seca', 'diesel'),
      mk('2026-05-17T12:00:00Z', 0, null, 'carga_seca', 'electrico'),
    ];
    const r = agregarPorCombustible(viajes);
    expect(r.find((b) => b.fuel_type === 'diesel')).toEqual({
      fuel_type: 'diesel',
      viajes: 2,
      co2e_kg: 180,
    });
    expect(r.find((b) => b.fuel_type === 'electrico')).toEqual({
      fuel_type: 'electrico',
      viajes: 1,
      co2e_kg: 0,
    });
  });
});
