import { describe, expect, it } from 'vitest';
import { driverPositionEventSchema } from './driver-position-event.js';

const validEvent = {
  viajeId: '11111111-1111-1111-1111-111111111111',
  vehiculoId: '22222222-2222-2222-2222-222222222222',
  lat: -33.4489,
  lng: -70.6693,
  registradoEn: '2026-06-23T10:00:00.000Z',
};

describe('driverPositionEventSchema', () => {
  it('acepta un evento válido completo', () => {
    const result = driverPositionEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.viajeId).toBe(validEvent.viajeId);
      expect(result.data.lat).toBe(validEvent.lat);
    }
  });

  it('rechaza lat fuera de rango (> 90)', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, lat: 91 });
    expect(result.success).toBe(false);
  });

  it('rechaza lat fuera de rango (< -90)', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, lat: -91 });
    expect(result.success).toBe(false);
  });

  it('rechaza lng fuera de rango (> 180)', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, lng: 181 });
    expect(result.success).toBe(false);
  });

  it('rechaza lng fuera de rango (< -180)', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, lng: -181 });
    expect(result.success).toBe(false);
  });

  it('rechaza viajeId que no es uuid', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, viajeId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rechaza vehiculoId que no es uuid', () => {
    const result = driverPositionEventSchema.safeParse({ ...validEvent, vehiculoId: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rechaza registradoEn que no es datetime ISO', () => {
    const result = driverPositionEventSchema.safeParse({
      ...validEvent,
      registradoEn: '2026-06-23',
    });
    expect(result.success).toBe(false);
  });
});
