import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { buildCrashSafetyEvent, shouldNotifyCustomerCrash } from './build-crash-safety-event.js';

describe('shouldNotifyCustomerCrash', () => {
  it('un pico bajo 3 G no avisa al cliente', () => {
    expect(shouldNotifyCustomerCrash(1)).toBe(false);
    expect(shouldNotifyCustomerCrash(2.9)).toBe(false);
  });

  it('3 G o más sí avisa', () => {
    expect(shouldNotifyCustomerCrash(3)).toBe(true);
    expect(shouldNotifyCustomerCrash(8.2)).toBe(true);
  });

  it('sin acelerómetro parseado (pico 0) sí avisa', () => {
    expect(shouldNotifyCustomerCrash(0)).toBe(true);
  });
});

describe('buildCrashSafetyEvent', () => {
  it('construye un SafetyEvent crash con vehicleId cuando está presente', () => {
    const vehicleId = '123e4567-e89b-12d3-a456-426614174000';
    const result: SafetyEvent = buildCrashSafetyEvent({
      imei: '863238075489155',
      vehicleId,
      occurredAtMs: 1749998520000,
    });

    expect(result.eventType).toBe('crash');
    expect(result.imei).toBe('863238075489155');
    expect(result.vehicleId).toBe(vehicleId);
    expect(result.occurredAt).toBe(new Date(1749998520000).toISOString());
    expect(result.rawValue).toBeUndefined();
  });

  it('omite vehicleId del output cuando el input es null', () => {
    const result: SafetyEvent = buildCrashSafetyEvent({
      imei: '863238075489155',
      vehicleId: null,
      occurredAtMs: 1749998520000,
    });

    expect(result.eventType).toBe('crash');
    expect(result.vehicleId).toBeUndefined();
    expect('vehicleId' in result).toBe(false);
  });

  it('convierte occurredAtMs como number a ISO string correcto', () => {
    const tsMs = 1749998520000;
    const result = buildCrashSafetyEvent({
      imei: '863238075489155',
      vehicleId: null,
      occurredAtMs: tsMs,
    });

    expect(result.occurredAt).toBe(new Date(1749998520000).toISOString());
  });

  it('convierte occurredAtMs como string numérico a ISO string correcto', () => {
    const result = buildCrashSafetyEvent({
      imei: '863238075489155',
      vehicleId: null,
      occurredAtMs: '1749998520000',
    });

    expect(result.occurredAt).toBe(new Date(1749998520000).toISOString());
  });
});
