import { describe, expect, it } from 'vitest';
import { routeSuggestionSchema } from './route-suggestion.js';

const base = {
  id: 'b3b8c1d2-0000-4000-8000-000000000001',
  viaje_id: 'b3b8c1d2-0000-4000-8000-000000000002',
  emitida_en: '2026-06-23T10:00:00.000Z',
  polyline_alternativa: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
  delta_eta_segundos: -120,
  delta_co2e_kg: '-0.340',
  eta_baseline_segundos: 3600,
  posicion_lat: '-33.457831',
  posicion_lng: '-70.648018',
  entregada: false,
  adoptada: null,
  evaluada_adopcion_en: null,
  creado_en: '2026-06-23T10:00:00.000Z',
  actualizado_en: '2026-06-23T10:00:00.000Z',
};

describe('routeSuggestionSchema', () => {
  it('parsea un objeto válido con campos nullables en null', () => {
    const parsed = routeSuggestionSchema.parse(base);
    expect(parsed.id).toBe(base.id);
    expect(parsed.viaje_id).toBe(base.viaje_id);
    expect(parsed.adoptada).toBeNull();
    expect(parsed.evaluada_adopcion_en).toBeNull();
    expect(parsed.entregada).toBe(false);
  });

  it('parsea correctamente cuando la sugerencia fue adoptada', () => {
    const parsed = routeSuggestionSchema.parse({
      ...base,
      entregada: true,
      adoptada: true,
      evaluada_adopcion_en: '2026-06-23T10:05:00.000Z',
    });
    expect(parsed.adoptada).toBe(true);
    expect(parsed.evaluada_adopcion_en).toBe('2026-06-23T10:05:00.000Z');
  });

  it('parsea correctamente cuando la sugerencia fue rechazada (adoptada=false)', () => {
    const parsed = routeSuggestionSchema.parse({
      ...base,
      entregada: true,
      adoptada: false,
      evaluada_adopcion_en: '2026-06-23T10:03:00.000Z',
    });
    expect(parsed.adoptada).toBe(false);
  });

  it('permite delta_eta_segundos negativo (la ruta alternativa es más rápida)', () => {
    const parsed = routeSuggestionSchema.parse({ ...base, delta_eta_segundos: -600 });
    expect(parsed.delta_eta_segundos).toBe(-600);
  });

  it('permite delta_co2e_kg negativo (la ruta alternativa emite menos CO2)', () => {
    const parsed = routeSuggestionSchema.parse({ ...base, delta_co2e_kg: '-1.500' });
    expect(parsed.delta_co2e_kg).toBe('-1.500');
  });

  it('rechaza posicion_lat fuera de rango (> 90)', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, posicion_lat: '91.000000' })).toThrow();
  });

  it('rechaza posicion_lat fuera de rango (< -90)', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, posicion_lat: '-90.000001' })).toThrow();
  });

  it('rechaza posicion_lng fuera de rango (> 180)', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, posicion_lng: '180.000001' })).toThrow();
  });

  it('rechaza posicion_lng fuera de rango (< -180)', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, posicion_lng: '-181.000000' })).toThrow();
  });

  it('acepta posicion_lat en el límite exacto de -90', () => {
    const parsed = routeSuggestionSchema.parse({ ...base, posicion_lat: '-90.000000' });
    expect(Number(parsed.posicion_lat)).toBe(-90);
  });

  it('acepta posicion_lng en el límite exacto de 180', () => {
    const parsed = routeSuggestionSchema.parse({ ...base, posicion_lng: '180.000000' });
    expect(Number(parsed.posicion_lng)).toBe(180);
  });

  it('rechaza id que no es UUID', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, id: 'no-un-uuid' })).toThrow();
  });

  it('rechaza viaje_id que no es UUID', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, viaje_id: 'no-un-uuid' })).toThrow();
  });

  it('rechaza emitida_en con formato no ISO 8601', () => {
    expect(() =>
      routeSuggestionSchema.parse({ ...base, emitida_en: '23-06-2026 10:00' }),
    ).toThrow();
  });

  it('rechaza eta_baseline_segundos negativo', () => {
    expect(() => routeSuggestionSchema.parse({ ...base, eta_baseline_segundos: -1 })).toThrow();
  });
});
