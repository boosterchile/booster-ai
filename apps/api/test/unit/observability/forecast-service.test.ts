import { describe, expect, it } from 'vitest';
import { ForecastService } from '../../../src/services/observability/forecast-service.js';

describe('ForecastService', () => {
  const svc = new ForecastService();

  it('día 15 de 30 → forecast = 2× MTD', () => {
    const now = new Date('2026-06-15T15:00:00Z'); // junio tiene 30 días
    const result = svc.forecast({
      mtdCostClp: 500_000,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.dayOfMonth).toBe(15);
    expect(result.daysInMonth).toBe(30);
    expect(result.forecastClpEndOfMonth).toBe(1_000_000);
    expect(result.budgetClp).toBe(925_000);
    expect(result.variancePercent).toBeCloseTo(8.1, 1); // (1M - 925k)/925k
  });

  it('día 1 → forecast escala a daysInMonth completos', () => {
    const now = new Date('2026-05-01T15:00:00Z'); // mayo: 31 días
    const result = svc.forecast({
      mtdCostClp: 30_000,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.dayOfMonth).toBe(1);
    expect(result.daysInMonth).toBe(31);
    expect(result.forecastClpEndOfMonth).toBe(930_000); // 30k × 31
  });

  it('día último del mes → forecast = MTD (no extrapola)', () => {
    const now = new Date('2026-05-31T15:00:00Z');
    const result = svc.forecast({
      mtdCostClp: 800_000,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.dayOfMonth).toBe(31);
    expect(result.daysInMonth).toBe(31);
    expect(result.forecastClpEndOfMonth).toBe(800_000);
    expect(result.daysRemaining).toBe(0);
  });

  it('MTD = 0 → forecast = 0 y variance es -100%', () => {
    const now = new Date('2026-05-15T15:00:00Z');
    const result = svc.forecast({
      mtdCostClp: 0,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.forecastClpEndOfMonth).toBe(0);
    expect(result.variancePercent).toBe(-100);
  });

  it('budget = 0 → variance = 0 (no division by zero)', () => {
    const now = new Date('2026-05-15T15:00:00Z');
    const result = svc.forecast({
      mtdCostClp: 500_000,
      budgetUsd: 0,
      clpPerUsd: 925,
      now,
    });
    expect(result.budgetClp).toBe(0);
    expect(result.variancePercent).toBe(0);
  });

  it('mtdCost negativo (créditos) → trata como 0', () => {
    const now = new Date('2026-05-15T15:00:00Z');
    const result = svc.forecast({
      mtdCostClp: -1000,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.forecastClpEndOfMonth).toBe(0);
  });

  it('febrero de año no bisiesto = 28 días', () => {
    const now = new Date('2026-02-14T15:00:00Z'); // 2026 no bisiesto
    const result = svc.forecast({
      mtdCostClp: 100_000,
      budgetUsd: 1000,
      clpPerUsd: 925,
      now,
    });
    expect(result.daysInMonth).toBe(28);
    expect(result.dayOfMonth).toBe(14);
    expect(result.forecastClpEndOfMonth).toBe(200_000); // 100k × 28 / 14
  });
});
