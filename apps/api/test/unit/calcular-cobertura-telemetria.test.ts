import { describe, expect, it } from 'vitest';
import {
  CONTINUITY_GAP_S,
  calcularCoberturaPura,
  haversineKm,
} from '../../src/services/calcular-cobertura-telemetria.js';

/**
 * Tests del cálculo puro de cobertura telemétrica (ADR-028 §5).
 *
 * El servicio que toca DB (`calcularCobertura`) es difícil de testear
 * sin un Postgres real (Drizzle no tiene mock built-in fácil). La lógica
 * crítica está extraída en funciones puras (`haversineKm`,
 * `calcularCoberturaPura`) que se testean acá exhaustivamente.
 *
 * Casos cubiertos:
 *   - haversine: pares conocidos con distancia documentada
 *   - cobertura: 0 pings, 1 ping, 2+ pings con/sin gaps de continuidad
 *   - boundary del threshold de gap (60s)
 *   - cap a 100 cuando los pings reportan más distancia que la estimada
 *   - sin distancia estimada → 0
 */

describe('haversineKm', () => {
  it('Santiago (Plaza de Armas) → Valparaíso (centro) ≈ 100 km', () => {
    // Plaza de Armas Santiago: -33.4378, -70.6504
    // Plaza Sotomayor Valparaíso: -33.0367, -71.6262
    // Distancia great-circle ≈ 100 km (vuelo directo, no ruta de
    // carretera).
    const km = haversineKm(-33.4378, -70.6504, -33.0367, -71.6262);
    expect(km).toBeGreaterThan(95);
    expect(km).toBeLessThan(105);
  });

  it('mismo punto → 0 km', () => {
    expect(haversineKm(-33.4, -70.6, -33.4, -70.6)).toBe(0);
  });

  it('1° de latitud (en ecuador) ≈ 111.2 km', () => {
    const km = haversineKm(0, 0, 1, 0);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it('simetría: haversine(A,B) = haversine(B,A)', () => {
    const ab = haversineKm(-33.4, -70.6, -33.05, -71.6);
    const ba = haversineKm(-33.05, -71.6, -33.4, -70.6);
    expect(ab).toBeCloseTo(ba, 6);
  });
});

describe('calcularCoberturaPura — casos vacíos / triviales', () => {
  it('0 pings → cobertura 0', () => {
    expect(calcularCoberturaPura([], 100)).toBe(0);
  });

  it('1 ping (no hay pares) → cobertura 0', () => {
    expect(calcularCoberturaPura([{ tMs: 0, lat: -33.4, lng: -70.6 }], 100)).toBe(0);
  });

  it('distanciaEstimadaKm = 0 → cobertura 0 (evita división por cero)', () => {
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.4, lng: -70.65 },
    ];
    expect(calcularCoberturaPura(pings, 0)).toBe(0);
  });

  it('distanciaEstimadaKm negativa (defensivo) → cobertura 0', () => {
    expect(calcularCoberturaPura([], -10)).toBe(0);
  });
});

describe('calcularCoberturaPura — pings continuos', () => {
  it('dos pings con gap < 60s → cobertura es proporcional a la distancia entre ellos', () => {
    // Dos pings separados 30s en tiempo y ~5.5km en espacio (1° de
    // longitud en latitud -33° ≈ 92km × 0.06° ≈ 5.5km).
    // Si la distancia estimada del trip total es 50km → cobertura ≈ 11%.
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.4, lng: -70.66 },
    ];
    const cov = calcularCoberturaPura(pings, 50);
    expect(cov).toBeGreaterThan(10);
    expect(cov).toBeLessThan(13);
  });

  it('serie de 5 pings continuos → suma todas las distancias intermedias', () => {
    // Cada ping a 30s, separados 1km uno del otro (~0.009° de longitud
    // a -33° de latitud ≈ 1km). Total acumulado = 4km en 4 pares.
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.4, lng: -70.6108 },
      { tMs: 60_000, lat: -33.4, lng: -70.6216 },
      { tMs: 90_000, lat: -33.4, lng: -70.6324 },
      { tMs: 120_000, lat: -33.4, lng: -70.6432 },
    ];
    const cov = calcularCoberturaPura(pings, 10);
    // Con cada ping 30s después y < 60s gap, todos cuentan.
    // 4 segmentos × ~1km = ~4km. 4/10 = 40%.
    expect(cov).toBeGreaterThan(35);
    expect(cov).toBeLessThan(45);
  });
});

describe('calcularCoberturaPura — gaps de discontinuidad', () => {
  it('gap > 60s entre pings NO suma al km cubierto', () => {
    // Dos pings separados 120s (gap > 60s) y 5km en espacio. NO debe
    // contar al km cubierto. Cobertura = 0.
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 120_000, lat: -33.4, lng: -70.66 },
    ];
    const cov = calcularCoberturaPura(pings, 50);
    expect(cov).toBe(0);
  });

  it('mezcla continuo + gap → solo cuenta el continuo', () => {
    // Pings 1-2: continuos (30s gap, ~1km).
    // Pings 2-3: gap 120s (NO cuenta).
    // Pings 3-4: continuos (30s gap, ~1km).
    // Total km cubiertos: ~2km de los 10 estimados → ~20%.
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 30_000, lat: -33.4, lng: -70.6108 }, // continuo
      { tMs: 150_000, lat: -33.4, lng: -70.7 }, // gap 120s — descarta
      { tMs: 180_000, lat: -33.4, lng: -70.7108 }, // continuo
    ];
    const cov = calcularCoberturaPura(pings, 10);
    expect(cov).toBeGreaterThan(15);
    expect(cov).toBeLessThan(25);
  });

  it('gap exactamente CONTINUITY_GAP_S es discontinuidad (no cuenta)', () => {
    // El threshold es < 60s (estricto). gap = 60s exacto NO cuenta
    // porque la condición es `gapS < CONTINUITY_GAP_S`.
    expect(CONTINUITY_GAP_S).toBe(60);
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 60_000, lat: -33.4, lng: -70.66 }, // gap = 60s → NO cuenta
    ];
    expect(calcularCoberturaPura(pings, 50)).toBe(0);
  });

  it('gap 59.9s SI cuenta (boundary)', () => {
    const pings = [
      { tMs: 0, lat: -33.4, lng: -70.6 },
      { tMs: 59_900, lat: -33.4, lng: -70.6108 },
    ];
    const cov = calcularCoberturaPura(pings, 10);
    expect(cov).toBeGreaterThan(0);
  });
});

describe('calcularCoberturaPura — cap', () => {
  it('si los pings reportan más distancia que la estimada, cap a 100', () => {
    // Caso: el conductor tomó una ruta más larga que la estimada
    // (por ejemplo, desvíos). Los pings suman 60km cuando la estimada
    // era 50km → 120% sin cap → 100% con cap.
    const pings = [
      { tMs: 0, lat: -33, lng: -70 },
      { tMs: 30_000, lat: -33.5, lng: -70.5 }, // ~70km
    ];
    const cov = calcularCoberturaPura(pings, 50);
    expect(cov).toBe(100);
  });
});
