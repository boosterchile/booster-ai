import { describe, expect, it, vi } from 'vitest';
import { haversineKm } from './calcular-cobertura-telemetria.js';
// RED: este módulo aún no existe — es el paso 1 del fix F0-0
// (.specs/distancia-real-hibrida/spec.md). El test falla al resolver el import
// hasta que se implemente calcularDistanciaHibrida.
import {
  type DistanciaHibridaResultado,
  type PingGps,
  calcularDistanciaHibrida,
  // RED (write): resolverEscrituraDistanciaReal aún no existe. Decide QUÉ se
  // persiste en metricas_viaje a partir de la híbrida, acoplando distancia_km_real
  // y coverage_pct (misma fuente) y blindando el 0 (certificates.ts:128 hace
  // `distanceKmActual ?? distanceKmEstimated` — un 0 NO es nullish → se comería
  // la estimación mostrando "0 km medidos").
  resolverEscrituraDistanciaReal,
} from './calcular-distancia-real.js';

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

  it('traza vacía o de un solo ping → distancia 0, cobertura 0, resolver NO llamado', async () => {
    const estimarHueco = vi.fn(async () => 5);
    const vacia = await calcularDistanciaHibrida([], estimarHueco);
    const unico = await calcularDistanciaHibrida([p0], estimarHueco);

    for (const r of [vacia, unico]) {
      expect(r.distanciaTotalKm).toBe(0);
      expect(r.coberturaObservadaPct).toBe(0);
      expect(r.segmentos).toHaveLength(0);
    }
    expect(estimarHueco).not.toHaveBeenCalled();
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

describe('resolverEscrituraDistanciaReal — qué persistir (write consistente + blindaje del 0)', () => {
  // Construye una híbrida mínima con overrides.
  const hib = (o: Partial<DistanciaHibridaResultado>): DistanciaHibridaResultado => ({
    distanciaTotalKm: 0,
    kmObservado: 0,
    kmEstimado: 0,
    coberturaObservadaPct: 0,
    segmentos: [],
    ...o,
  });

  it('con observación (kmObservado>0) → persiste distancia_km_real y coverage_pct de la MISMA híbrida', () => {
    const h = hib({
      distanciaTotalKm: 100,
      kmObservado: 60,
      kmEstimado: 40,
      coberturaObservadaPct: 60,
    });
    const w = resolverEscrituraDistanciaReal(h);
    expect(w.distanciaKmReal).toBe(100);
    expect(w.coveragePct).toBe(60);
    // Consistencia: la fracción medida declarada (X=coverage) sobre la distancia
    // persistida reconstruye los km observados. Si X viniera de otro cálculo,
    // esto NO cerraría — y el cert declararía "medido X%" sobre un número ajeno.
    expect((w.distanciaKmReal! * w.coveragePct) / 100).toBeCloseTo(h.kmObservado, 6);
  });

  it('trip SIN pings (total 0) → NO persiste (null), jamás 0 — el ?? no se come un cero', () => {
    const w = resolverEscrituraDistanciaReal(hib({ distanciaTotalKm: 0, kmObservado: 0 }));
    expect(w.distanciaKmReal).toBeNull();
    expect(w.distanciaKmReal).not.toBe(0);
    expect(w.coveragePct).toBe(0);
  });

  it('todos los gaps ≥60s (total>0 pero kmObservado=0) → NO persiste como real (null), cae a estimación', () => {
    const w = resolverEscrituraDistanciaReal(
      hib({ distanciaTotalKm: 80, kmObservado: 0, kmEstimado: 80, coberturaObservadaPct: 0 }),
    );
    // No mostrar un relleno 100% Routes bajo el campo "distancia real": sin
    // observación no hay medición → el cert cae a la estimación via ??.
    expect(w.distanciaKmReal).toBeNull();
    expect(w.coveragePct).toBe(0);
  });

  it('distancia_km_real es SIEMPRE null o >0, nunca 0 (blindaje del ??)', () => {
    const casos = [
      hib({ distanciaTotalKm: 0, kmObservado: 0 }),
      hib({ distanciaTotalKm: 80, kmObservado: 0, coberturaObservadaPct: 0 }),
      hib({ distanciaTotalKm: 50, kmObservado: 30, coberturaObservadaPct: 60 }),
    ];
    for (const c of casos) {
      const w = resolverEscrituraDistanciaReal(c);
      expect(w.distanciaKmReal === null || w.distanciaKmReal > 0, JSON.stringify(w)).toBe(true);
    }
  });

  it('idempotente: misma híbrida → misma escritura (sin drift entre corridas)', () => {
    const h = hib({
      distanciaTotalKm: 50,
      kmObservado: 30,
      kmEstimado: 20,
      coberturaObservadaPct: 60,
    });
    expect(resolverEscrituraDistanciaReal(h)).toEqual(resolverEscrituraDistanciaReal(h));
  });

  it('distancia_km_real=null ⇒ coverage_pct=0 finito (nunca kmObs/null → NaN): el ?? del coverage', () => {
    // Contraparte del blindaje del ?? en el eje de la cobertura: sin distancia
    // real no se puede dividir por null. coverage debe ser 0 (fuerza path
    // secundario, ADR-028 §5), NUNCA NaN/null/Infinity.
    for (const c of [
      hib({ distanciaTotalKm: 0, kmObservado: 0 }),
      hib({ distanciaTotalKm: 80, kmObservado: 0, coberturaObservadaPct: 0 }),
    ]) {
      const w = resolverEscrituraDistanciaReal(c);
      expect(w.distanciaKmReal).toBeNull();
      expect(w.coveragePct).toBe(0);
      expect(Number.isFinite(w.coveragePct)).toBe(true);
      expect(Number.isNaN(w.coveragePct)).toBe(false);
    }
  });
});
