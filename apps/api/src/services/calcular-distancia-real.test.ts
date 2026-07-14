import { describe, expect, it, vi } from 'vitest';
import { haversineKm } from './calcular-cobertura-telemetria.js';
// RED: este módulo aún no existe — es el paso 1 del fix F0-0
// (.specs/distancia-real-hibrida/spec.md). El test falla al resolver el import
// hasta que se implemente calcularDistanciaHibrida.
import { type PingGps, calcularDistanciaHibrida } from './calcular-distancia-real.js';

// Pings de referencia (Santiago). tMs fijos para evitar flakiness.
const p0: PingGps = { tMs: 1_000_000, lat: -33.45, lng: -70.66 };
const p1: PingGps = { tMs: 1_030_000, lat: -33.46, lng: -70.67 }; // +30s desde p0 → observado
const p2: PingGps = { tMs: 1_150_000, lat: -33.5, lng: -70.7 }; //  +120s desde p1 → hueco (≥60s)

describe('calcularDistanciaHibrida', () => {
  it('criterio 3 — traza continua: distancia = observada, cobertura 100%, resolver NO llamado', async () => {
    const estimarHueco = vi.fn(async () => 999); // no debe usarse
    const r = await calcularDistanciaHibrida([p0, p1], estimarHueco);

    expect(estimarHueco).not.toHaveBeenCalled();
    expect(r.kmEstimado).toBe(0);
    expect(r.coberturaObservadaPct).toBe(100);
    expect(r.distanciaTotalKm).toBeCloseTo(haversineKm(p0.lat, p0.lng, p1.lat, p1.lng), 6);
    expect(r.distanciaTotalKm).toBe(r.kmObservado);
  });

  it('criterio 1 — NO subestimación: un hueco entra vía resolver, distancia > kmObservado', async () => {
    const estimarHueco = vi.fn(async () => 10);
    const r = await calcularDistanciaHibrida([p1, p2], estimarHueco);

    // kmCubiertos crudo daría 0 (el tramo es un hueco). El híbrido NO subestima.
    expect(r.kmObservado).toBe(0);
    expect(r.kmEstimado).toBe(10);
    expect(r.distanciaTotalKm).toBe(10);
    expect(r.distanciaTotalKm).toBeGreaterThan(r.kmObservado);
  });

  it('criterio 2 — NO colapso: el hueco se estima POR-TRAMO entre sus dos pings', async () => {
    const estimarHueco = vi.fn(async () => 7);
    const r = await calcularDistanciaHibrida([p0, p1, p2], estimarHueco);

    // el resolver se llama con los extremos DEL HUECO (p1,p2), no con la ruta total.
    expect(estimarHueco).toHaveBeenCalledTimes(1);
    expect(estimarHueco).toHaveBeenCalledWith(p1, p2);

    const obs = haversineKm(p0.lat, p0.lng, p1.lat, p1.lng);
    expect(r.kmObservado).toBeCloseTo(obs, 6);
    expect(r.distanciaTotalKm).toBeCloseTo(obs + 7, 6);
    expect(r.distanciaTotalKm).toBeGreaterThan(r.kmObservado);
  });

  it('criterio 4 — cobertura consistente: coverage == kmObservado/total y ∈ [0,100]', async () => {
    const estimarHueco = vi.fn(async () => 7);
    const r = await calcularDistanciaHibrida([p0, p1, p2], estimarHueco);

    expect(r.coberturaObservadaPct).toBeCloseTo((r.kmObservado / r.distanciaTotalKm) * 100, 6);
    expect(r.coberturaObservadaPct).toBeGreaterThanOrEqual(0);
    expect(r.coberturaObservadaPct).toBeLessThanOrEqual(100);
  });

  it('criterio 5 — Routes caído: no revienta el cierre, cae a fallback declarado y no subestima', async () => {
    const estimarHueco = vi.fn(async () => {
      throw new Error('Routes API timeout');
    });

    const r = await calcularDistanciaHibrida([p1, p2], estimarHueco);

    // no tira; el hueco queda como fallback declarado (no descartado → 0).
    const gap = r.segmentos.find((s) => s.desde === p1 && s.hasta === p2);
    expect(gap?.tipo).toBe('estimado_fallback');
    // el fallback es al menos la línea recta (piso), nunca 0 (subestimación silenciosa).
    expect(gap?.km).toBeGreaterThanOrEqual(haversineKm(p1.lat, p1.lng, p2.lat, p2.lng));
    expect(Number.isFinite(r.distanciaTotalKm)).toBe(true);
    expect(r.distanciaTotalKm).toBeGreaterThan(0);
  });
});
