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
  // `speed` default = velocidad de marcha (40 km/h): un punto se considera "en
  // movimiento" salvo que el test lo ponga a 0 explícitamente.
  const p = (
    tMs: number,
    lat: number,
    lng: number,
    fuel: number | null = null,
    km: number | null = null,
    speed: number | null = 40,
  ): TrazaPoint => ({ tMs, lat, lng, fuelConsumedL: fuel, totalMileageKm: km, speedKmh: speed });

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
      p(60_000, -33.5, -70.6, null, null, 40), // punto SIN CAN en el medio, en marcha
      p(120_000, -33.6, -70.6, 64118.5, 715017.215),
    ];
    const r = construirResumen(pts);
    expect(r.litrosConsumidos).toBeCloseTo(391.5, 1); // 64118.5 - 63727.0
    expect(r.kmCan).toBeCloseTo(993.785, 2); // 715017.215 - 714023.43
    expect(r.distanciaKm).toBeGreaterThan(0);
  });

  it('un solo punto con CAN → litros/km null (necesita Δ), no rompe', () => {
    const r = construirResumen([p(0, -33.4, -70.6, 100, 5), p(60_000, -33.5, -70.6)]);
    expect(r.litrosConsumidos).toBeNull();
    expect(r.kmCan).toBeNull();
  });
});

// =============================================================================
// Duración de MOVIMIENTO (no span). El corazón del fix: suma de intervalos
// entre puntos consecutivos EXCLUYENDO paradas (velocidad ≈ 0) y huecos sin
// pings (device apagado). Ver `.specs/historial-duracion-movimiento/`.
// =============================================================================
describe('construirResumen — duración de movimiento', () => {
  const S = 1000;
  const p = (tSec: number, speed: number | null): TrazaPoint => ({
    tMs: tSec * S,
    // Se mueve ~0.001° por punto para que la distancia sea > 0; irrelevante
    // para la duración (que sale de tiempos+velocidad, no de la geometría).
    lat: -33.4 - tSec * 0.00001,
    lng: -70.6,
    fuelConsumedL: null,
    totalMileageKm: null,
    speedKmh: speed,
  });

  it('todo en movimiento, sin huecos → duración ≈ span', () => {
    const pts = [p(0, 40), p(60, 40), p(120, 40), p(180, 40)]; // 3 min, cadencia 60 s
    const r = construirResumen(pts);
    expect(r.duracionMin).toBeCloseTo(3, 5); // = span, todo cuenta
  });

  it('parada larga en el medio (velocidad 0 sostenida) → duración < span', () => {
    // 0-120s marcha; 120-240s parado (2 min); 240-360s marcha. Cadencia 60 s.
    const pts = [
      p(0, 40),
      p(60, 40), // [0→60] marcha
      p(120, 0), // [60→120] max(40,0)=40 → cuenta (frenado)
      p(180, 0), // [120→180] max(0,0)=0 → NO cuenta (parado)
      p(240, 0), // [180→240] parado → NO cuenta
      p(300, 40), // [240→300] max(0,40)=40 → cuenta (acelerando)
      p(360, 40), // [300→360] marcha
    ];
    const r = construirResumen(pts);
    const spanMin = 360 / 60; // 6 min
    expect(r.duracionMin).toBeCloseTo(4, 5); // 4 tramos × 60 s
    expect(r.duracionMin).toBeLessThan(spanMin); // < span (excluye 2 min de parada)
  });

  it('hueco sin pings (device apagado) NO cuenta, aunque despierte en marcha', () => {
    // 0-60s marcha; hueco de 30 min sin pings; despierta a 40 km/h.
    const pts = [
      p(0, 40),
      p(60, 40), // [0→60] cuenta
      p(60 + 30 * 60, 40), // Δt = 30 min > MAX_GAP → NO cuenta el hueco
      p(60 + 31 * 60, 40), // [.. +60s] cuenta
    ];
    const r = construirResumen(pts);
    expect(r.duracionMin).toBeCloseTo(2, 5); // solo los 2 tramos de 60 s
    expect(r.duracionMin).toBeLessThan((60 + 31 * 60) / 60); // ≪ span (32 min)
  });

  it('1 solo punto → duración 0 (no hay intervalo), no rompe', () => {
    expect(construirResumen([p(0, 40)]).duracionMin).toBe(0);
  });

  it('timestamps duplicados / no monótonos (Δt ≤ 0) → no suman', () => {
    const pts = [p(0, 40), p(0, 40), p(60, 40)]; // primer Δt = 0
    expect(construirResumen(pts).duracionMin).toBeCloseTo(1, 5); // solo [0→60]
  });

  it('velocidad null se trata como parado (conservador)', () => {
    const pts = [p(0, null), p(60, null), p(120, 40), p(180, 40)];
    // [0→60] max(null,null)→0 NO cuenta; [60→120] max(0,40)=40 cuenta; [120→180] cuenta.
    expect(construirResumen(pts).duracionMin).toBeCloseTo(2, 5);
  });

  it('el aislamiento de un tramo lo hace el caller: la duración es la de los puntos dados', () => {
    // Simula "aislar un tramo del día": solo los puntos de ese tramo.
    const tramo = [p(3600, 40), p(3660, 40), p(3720, 0), p(3780, 0)];
    // [3600→3660] cuenta; [3660→3720] max(40,0) cuenta; [3720→3780] parado NO.
    expect(construirResumen(tramo).duracionMin).toBeCloseTo(2, 5);
  });
});
