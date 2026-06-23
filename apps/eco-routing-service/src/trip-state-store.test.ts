/**
 * TDD — TripStateStore (in-memory con TTL)
 *
 * Cobertura obligatoria:
 * - puedeSugerir: false dentro del cooldown, true después de que elapsa
 * - getEstado / setPosicion / setBaseline: round-trip
 * - registrarSugerencia: establece el timestamp de la última sugerencia
 * - TTL: el estado expira tras el TTL
 */

import { describe, expect, it, vi } from 'vitest';
import { createInMemoryTripStateStore } from './trip-state-store.js';

describe('InMemoryTripStateStore', () => {
  describe('getEstado', () => {
    it('retorna null cuando el viaje no existe', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      expect(store.getEstado('viaje-inexistente')).toBeNull();
    });

    it('retorna el estado inicial tras setPosicion', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setPosicion('viaje-1', {
        lat: -33.4,
        lng: -70.6,
        registradoEn: new Date().toISOString(),
      });
      const estado = store.getEstado('viaje-1');
      expect(estado).not.toBeNull();
      expect(estado?.posicionActual.lat).toBe(-33.4);
      expect(estado?.posicionActual.lng).toBe(-70.6);
    });
  });

  describe('setPosicion', () => {
    it('actualiza la posicion de un viaje existente', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setPosicion('viaje-1', {
        lat: -33.4,
        lng: -70.6,
        registradoEn: '2026-06-23T10:00:00Z',
      });
      store.setPosicion('viaje-1', {
        lat: -33.5,
        lng: -70.7,
        registradoEn: '2026-06-23T10:01:00Z',
      });
      const estado = store.getEstado('viaje-1');
      expect(estado?.posicionActual.lat).toBe(-33.5);
      expect(estado?.posicionActual.lng).toBe(-70.7);
    });

    it('crea nuevo estado si el viaje no existia', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      expect(store.getEstado('viaje-nuevo')).toBeNull();
      store.setPosicion('viaje-nuevo', {
        lat: -34.0,
        lng: -71.0,
        registradoEn: new Date().toISOString(),
      });
      expect(store.getEstado('viaje-nuevo')).not.toBeNull();
    });
  });

  describe('setBaseline', () => {
    it('persiste el ETA baseline en el estado del viaje', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setPosicion('viaje-1', {
        lat: -33.4,
        lng: -70.6,
        registradoEn: new Date().toISOString(),
      });
      store.setBaseline('viaje-1', 3600); // 1 hora
      const estado = store.getEstado('viaje-1');
      expect(estado?.etaBaselineSegundos).toBe(3600);
    });

    it('crea el estado si no existia al llamar setBaseline', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setBaseline('viaje-sin-posicion', 1800);
      const estado = store.getEstado('viaje-sin-posicion');
      expect(estado?.etaBaselineSegundos).toBe(1800);
    });
  });

  describe('registrarSugerencia', () => {
    it('establece el timestamp de la ultima sugerencia', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setPosicion('viaje-1', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      store.registrarSugerencia('viaje-1');
      const estado = store.getEstado('viaje-1');
      expect(estado?.ultimaSugerenciaEn).toEqual(now);

      vi.useRealTimers();
    });
  });

  describe('puedeSugerir', () => {
    it('retorna true cuando no hay sugerencia previa', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      store.setPosicion('viaje-1', {
        lat: -33.4,
        lng: -70.6,
        registradoEn: new Date().toISOString(),
      });
      expect(store.puedeSugerir('viaje-1', 300)).toBe(true);
    });

    it('retorna true para viaje que no existe en el store', () => {
      const store = createInMemoryTripStateStore({ ttlMs: 60_000 });
      // Si no existe, no hay sugerencia previa → puede sugerir
      expect(store.puedeSugerir('viaje-inexistente', 300)).toBe(true);
    });

    it('retorna false dentro del cooldown tras una sugerencia', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // TTL largo (1h) para que el avance de 100s no expire la entrada
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      store.setPosicion('viaje-1', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      store.registrarSugerencia('viaje-1'); // marca ahora

      // Avanzamos 100 segundos (cooldown = 300)
      vi.setSystemTime(new Date(now.getTime() + 100_000));
      expect(store.puedeSugerir('viaje-1', 300)).toBe(false);

      vi.useRealTimers();
    });

    it('retorna false en el exacto limite del cooldown (exclusivo)', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // TTL largo para que el avance de 300s no expire la entrada
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      store.setPosicion('viaje-1', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      store.registrarSugerencia('viaje-1');

      // exactamente en el límite (300s): todavía NO puede sugerir (exclusivo)
      vi.setSystemTime(new Date(now.getTime() + 300_000));
      expect(store.puedeSugerir('viaje-1', 300)).toBe(false);

      vi.useRealTimers();
    });

    it('retorna true una vez que el cooldown ha expirado (300s + 1ms)', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // TTL largo para que el avance no expire la entrada
      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      store.setPosicion('viaje-1', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      store.registrarSugerencia('viaje-1');

      // 300s + 1ms más: cooldown expirado → puede sugerir
      vi.setSystemTime(new Date(now.getTime() + 300_001));
      expect(store.puedeSugerir('viaje-1', 300)).toBe(true);

      vi.useRealTimers();
    });

    it('cooldown de 0 segundos siempre permite sugerir (sin cooldown)', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const store = createInMemoryTripStateStore({ ttlMs: 60 * 60 * 1000 });
      store.setPosicion('viaje-1', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      store.registrarSugerencia('viaje-1');

      // cooldown=0 → no hay cooldown → siempre permite
      expect(store.puedeSugerir('viaje-1', 0)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('TTL', () => {
    it('el estado expira tras el TTL configurado', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const store = createInMemoryTripStateStore({ ttlMs: 1_000 }); // TTL 1 segundo
      store.setPosicion('viaje-ttl', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });
      expect(store.getEstado('viaje-ttl')).not.toBeNull();

      // Avanzar 2 segundos (más allá del TTL)
      vi.setSystemTime(new Date(now.getTime() + 2_000));
      expect(store.getEstado('viaje-ttl')).toBeNull();

      vi.useRealTimers();
    });

    it('el estado no expira antes del TTL', () => {
      const now = new Date('2026-06-23T10:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const store = createInMemoryTripStateStore({ ttlMs: 5_000 });
      store.setPosicion('viaje-ttl', { lat: -33.4, lng: -70.6, registradoEn: now.toISOString() });

      vi.setSystemTime(new Date(now.getTime() + 4_000));
      expect(store.getEstado('viaje-ttl')).not.toBeNull();

      vi.useRealTimers();
    });
  });
});
