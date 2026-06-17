import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import { buildCrashSafetyEvent } from './build-crash-safety-event.js';

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
