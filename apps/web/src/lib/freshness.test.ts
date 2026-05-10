import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ageSeconds, formatAge, freshnessClass, freshnessLevel } from './freshness.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ageSeconds', () => {
  it('null/undefined → null', () => {
    expect(ageSeconds(null)).toBeNull();
    expect(ageSeconds(undefined)).toBeNull();
  });

  it('Date object 30s atrás → 30', () => {
    const past = new Date('2026-05-10T11:59:30Z');
    expect(ageSeconds(past)).toBe(30);
  });

  it('string ISO 8601 5min atrás → 300', () => {
    expect(ageSeconds('2026-05-10T11:55:00Z')).toBe(300);
  });

  it('string inválido → null', () => {
    expect(ageSeconds('no-es-fecha')).toBeNull();
  });

  it('fecha en el futuro → 0 (clamp)', () => {
    expect(ageSeconds('2026-05-10T13:00:00Z')).toBe(0);
  });
});

describe('formatAge', () => {
  it('null → null', () => {
    expect(formatAge(null)).toBeNull();
  });
  it('< 5s → "ahora"', () => {
    expect(formatAge(0)).toBe('ahora');
    expect(formatAge(4)).toBe('ahora');
  });
  it('5-59s → "hace Xs"', () => {
    expect(formatAge(5)).toBe('hace 5s');
    expect(formatAge(59)).toBe('hace 59s');
  });
  it('1-59min → "hace X min"', () => {
    expect(formatAge(60)).toBe('hace 1 min');
    expect(formatAge(60 * 59)).toBe('hace 59 min');
  });
  it('1h sin minutos sobrantes → "hace X h"', () => {
    expect(formatAge(60 * 60)).toBe('hace 1 h');
    expect(formatAge(60 * 60 * 5)).toBe('hace 5 h');
  });
  it('horas con minutos sobrantes → "hace X h Y min"', () => {
    expect(formatAge(60 * 60 + 60 * 12)).toBe('hace 1 h 12 min');
    expect(formatAge(60 * 60 * 2 + 60 * 30)).toBe('hace 2 h 30 min');
  });
  it('1 día → "hace 1 día" (singular)', () => {
    expect(formatAge(60 * 60 * 24)).toBe('hace 1 día');
  });
  it('N días → "hace N días" (plural)', () => {
    expect(formatAge(60 * 60 * 24 * 3)).toBe('hace 3 días');
  });
});

describe('freshnessLevel', () => {
  it('null → unknown', () => {
    expect(freshnessLevel(null)).toBe('unknown');
  });
  it('< 5 min default → fresh', () => {
    expect(freshnessLevel(0)).toBe('fresh');
    expect(freshnessLevel(60)).toBe('fresh');
    expect(freshnessLevel(60 * 5 - 1)).toBe('fresh');
  });
  it('5 min ≤ x < 1 h default → stale', () => {
    expect(freshnessLevel(60 * 5)).toBe('stale');
    expect(freshnessLevel(60 * 30)).toBe('stale');
    expect(freshnessLevel(60 * 60 - 1)).toBe('stale');
  });
  it('≥ 1 h default → old', () => {
    expect(freshnessLevel(60 * 60)).toBe('old');
    expect(freshnessLevel(60 * 60 * 5)).toBe('old');
  });
  it('thresholds custom', () => {
    expect(freshnessLevel(20, { staleSeconds: 10, oldSeconds: 30 })).toBe('stale');
    expect(freshnessLevel(40, { staleSeconds: 10, oldSeconds: 30 })).toBe('old');
    expect(freshnessLevel(5, { staleSeconds: 10, oldSeconds: 30 })).toBe('fresh');
  });
});

describe('freshnessClass', () => {
  it('mapea cada level a su Tailwind class', () => {
    expect(freshnessClass('fresh')).toBe('text-neutral-700');
    expect(freshnessClass('stale')).toBe('text-amber-700');
    expect(freshnessClass('old')).toContain('text-rose-700');
    expect(freshnessClass('unknown')).toBe('text-neutral-400');
  });
});
