import { describe, expect, it } from 'vitest';
import {
  type TrazaPoint,
  construirResumen,
  distanciaTotalKm,
  downsampleTraza,
  extraerCanAcumulado,
} from '../../src/services/obtener-traza-vehiculo.js';

describe('distanciaTotalKm', () => {
  it('vacío o 1 punto → 0', () => {
    expect(distanciaTotalKm([])).toBe(0);
    expect(distanciaTotalKm([{ lat: -33.45, lng: -70.66 }])).toBe(0);
  });

  it('2 puntos → ~haversine entre ellos (~1.1 km por 0.01° de lat)', () => {
    const d = distanciaTotalKm([
      { lat: -33.45, lng: -70.66 },
      { lat: -33.46, lng: -70.66 },
    ]);
    expect(d).toBeGreaterThan(1.0);
    expect(d).toBeLessThan(1.3);
  });

  it('suma los tramos consecutivos', () => {
    const a = distanciaTotalKm([
      { lat: -33.4, lng: -70.6 },
      { lat: -33.5, lng: -70.6 },
    ]);
    const b = distanciaTotalKm([
      { lat: -33.5, lng: -70.6 },
      { lat: -33.6, lng: -70.6 },
    ]);
    const ab = distanciaTotalKm([
      { lat: -33.4, lng: -70.6 },
      { lat: -33.5, lng: -70.6 },
      { lat: -33.6, lng: -70.6 },
    ]);
    expect(ab).toBeCloseTo(a + b, 5);
  });
});

describe('downsampleTraza (Douglas-Peucker por conteo)', () => {
  const linea = Array.from({ length: 100 }, (_, i) => ({ lat: -33 - i * 0.001, lng: -70, idx: i }));

  it('menos puntos que el cap → sin cambios', () => {
    const pts = linea.slice(0, 10);
    expect(downsampleTraza(pts, 50)).toEqual(pts);
  });

  it('respeta el cap: nunca devuelve más de maxPuntos', () => {
    expect(downsampleTraza(linea, 20).length).toBeLessThanOrEqual(20);
    expect(downsampleTraza(linea, 5).length).toBeLessThanOrEqual(5);
  });

  it('preserva los extremos (primer y último punto)', () => {
    const out = downsampleTraza(linea, 20);
    expect(out[0]).toEqual(linea[0]);
    expect(out.at(-1)).toEqual(linea.at(-1));
  });

  it('preserva un vértice agudo por sobre puntos colineales', () => {
    const pts = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
      { lat: 5, lng: 3 }, // pico lejos de la recta
      { lat: 0, lng: 4 },
      { lat: 0, lng: 5 },
      { lat: 0, lng: 6 },
    ];
    const out = downsampleTraza(pts, 4);
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out).toContainEqual({ lat: 5, lng: 3 }); // el pico está
    expect(out[0]).toEqual({ lat: 0, lng: 0 });
    expect(out.at(-1)).toEqual({ lat: 0, lng: 6 });
  });
});

describe('extraerCanAcumulado', () => {
  it('io_data con 83/87 → escalados (×0.1 L, /1000 km)', () => {
    const r = extraerCanAcumulado({ '83': 641185, '87': 715017215, '85': 852 });
    expect(r.fuelConsumedL).toBeCloseTo(64118.5, 3);
    expect(r.totalMileageKm).toBeCloseTo(715017.215, 3);
  });

  it('io_data sin CAN → ambos null, no rompe', () => {
    expect(extraerCanAcumulado({ '16': 972232 })).toEqual({
      fuelConsumedL: null,
      totalMileageKm: null,
    });
    expect(extraerCanAcumulado(null)).toEqual({ fuelConsumedL: null, totalMileageKm: null });
    expect(extraerCanAcumulado('garbage')).toEqual({ fuelConsumedL: null, totalMileageKm: null });
  });
});

describe('construirResumen', () => {
  const p = (
    tMs: number,
    lat: number,
    lng: number,
    fuel: number | null = null,
    km: number | null = null,
  ): TrazaPoint => ({ tMs, lat, lng, fuelConsumedL: fuel, totalMileageKm: km });

  it('sin puntos → distancia/duración 0, CAN null', () => {
    expect(construirResumen([])).toEqual({
      distanciaKm: 0,
      duracionMin: 0,
      litrosConsumidos: null,
      kmCan: null,
    });
  });

  it('con CAN → litros = Δ83 y km = Δ87 entre primer y último punto con CAN', () => {
    const pts = [
      p(0, -33.4, -70.6, 63727.0, 714023.43),
      p(60_000, -33.5, -70.6), // punto SIN CAN en el medio
      p(120_000, -33.6, -70.6, 64118.5, 715017.215),
    ];
    const r = construirResumen(pts);
    expect(r.litrosConsumidos).toBeCloseTo(391.5, 1); // 64118.5 - 63727.0
    expect(r.kmCan).toBeCloseTo(993.785, 2); // 715017.215 - 714023.43
    expect(r.duracionMin).toBeCloseTo(2, 5); // 120000 ms
    expect(r.distanciaKm).toBeGreaterThan(0);
  });

  it('un solo punto con CAN → litros/km null (necesita Δ), no rompe', () => {
    const r = construirResumen([p(0, -33.4, -70.6, 100, 5), p(60_000, -33.5, -70.6)]);
    expect(r.litrosConsumidos).toBeNull();
    expect(r.kmCan).toBeNull();
  });
});
