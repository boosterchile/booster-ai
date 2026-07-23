import { describe, expect, it, vi } from 'vitest';
import {
  CLIMA_TTL_MS,
  type ClimaCacheEntry,
  celdaKey,
  obtenerTemperaturaAmbiente,
} from '../../src/services/clima-ambiente-cache.js';

/**
 * Caché de clima por celda geográfica. ToS Google: cachear ≤ 1h, sin
 * persistir junto a telemetría ni histórico → Map efímero + TTL.
 */

describe('celdaKey — redondeo a 0.1° (~10 km)', () => {
  it('coords cercanas (misma celda 0.1°) → misma key', () => {
    // Ambas redondean a -33.4,-70.7 (celda [-33.45,-33.35) × [-70.75,-70.65)).
    expect(celdaKey(-33.44, -70.66)).toBe(celdaKey(-33.42, -70.68));
  });
  it('coords lejanas caen en celdas distintas', () => {
    expect(celdaKey(-33.44, -70.66)).not.toBe(celdaKey(-33.61, -70.66));
  });
});

describe('obtenerTemperaturaAmbiente — caché hot/cold/TTL/error', () => {
  const make = () => new Map<string, ClimaCacheEntry>();

  it('caché FRÍO → llama a la API una vez y cachea', async () => {
    const cache = make();
    const fetchClima = vi.fn().mockResolvedValue(21.5);
    const t = await obtenerTemperaturaAmbiente({
      lat: -33.44,
      lng: -70.66,
      nowMs: 1_000_000,
      fetchClima,
      cache,
    });
    expect(t).toBe(21.5);
    expect(fetchClima).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it('caché CALIENTE (misma celda, dentro del TTL) → NO llama a la API', async () => {
    const cache = make();
    const fetchClima = vi.fn().mockResolvedValue(21.5);
    await obtenerTemperaturaAmbiente({
      lat: -33.44,
      lng: -70.66,
      nowMs: 1_000_000,
      fetchClima,
      cache,
    });
    // 2ª lectura, misma celda (-33.4,-70.7), 5 min después (< TTL 30 min).
    const t = await obtenerTemperaturaAmbiente({
      lat: -33.42,
      lng: -70.68,
      nowMs: 1_000_000 + 5 * 60_000,
      fetchClima,
      cache,
    });
    expect(t).toBe(21.5);
    expect(fetchClima).toHaveBeenCalledTimes(1); // NO se llamó de nuevo
  });

  it('TTL EXPIRA → vuelve a llamar', async () => {
    const cache = make();
    const fetchClima = vi.fn().mockResolvedValueOnce(21.5).mockResolvedValueOnce(19.0);
    await obtenerTemperaturaAmbiente({
      lat: -33.44,
      lng: -70.66,
      nowMs: 1_000_000,
      fetchClima,
      cache,
    });
    const t = await obtenerTemperaturaAmbiente({
      lat: -33.44,
      lng: -70.66,
      nowMs: 1_000_000 + CLIMA_TTL_MS + 1,
      fetchClima,
      cache,
    });
    expect(t).toBe(19.0);
    expect(fetchClima).toHaveBeenCalledTimes(2);
  });

  it('la API FALLA (throw) → devuelve null, no rompe, no cachea', async () => {
    const cache = make();
    const fetchClima = vi.fn().mockRejectedValue(new Error('weather down'));
    const t = await obtenerTemperaturaAmbiente({
      lat: -33.44,
      lng: -70.66,
      nowMs: 1_000_000,
      fetchClima,
      cache,
    });
    expect(t).toBeNull();
    expect(cache.size).toBe(0); // no cacheó el fallo → reintentará
  });
});
