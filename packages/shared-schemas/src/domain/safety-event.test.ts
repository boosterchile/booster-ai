import { describe, expect, it } from 'vitest';
import { safetyEventSchema } from './safety-event.js';

describe('safetyEventSchema', () => {
  it('parsea un evento válido', () => {
    const parsed = safetyEventSchema.parse({
      eventType: 'crash',
      imei: '863238075489155',
      vehicleId: '6487dac2-600e-4655-a20e-2ea77a6b1017',
      occurredAt: '2026-06-15T14:32:00.000Z',
      rawValue: 2,
    });
    expect(parsed.eventType).toBe('crash');
  });

  it('rechaza eventType desconocido', () => {
    expect(() =>
      safetyEventSchema.parse({
        eventType: 'foo',
        imei: '863238075489155',
        occurredAt: '2026-06-15T14:32:00.000Z',
      }),
    ).toThrow();
  });

  it('rechaza imei no-numérico o de largo inválido', () => {
    for (const imei of ['x', '1', '12345678901234567', 'abc']) {
      expect(() =>
        safetyEventSchema.parse({
          eventType: 'crash',
          imei,
          occurredAt: '2026-06-15T14:32:00.000Z',
        }),
      ).toThrow();
    }
  });

  it('imei es obligatorio; vehicleId es opcional', () => {
    const parsed = safetyEventSchema.parse({
      eventType: 'unplug',
      imei: '863238075489155',
      occurredAt: '2026-06-15T14:32:00.000Z',
    });
    expect(parsed.vehicleId).toBeUndefined();
  });
});
