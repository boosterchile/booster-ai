import { describe, expect, it } from 'vitest';
import { isRealCalendarDate, isoCalendarDateSchema } from './dates.js';

describe('isRealCalendarDate', () => {
  it.each(['2026-06-11', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01'])(
    'acepta un día de calendario real (%s)',
    (s) => {
      expect(isRealCalendarDate(s)).toBe(true);
    },
  );

  it.each([
    ['formato no ISO', '11/06/2026'],
    ['día inexistente', '2026-02-31'],
    ['mes 13', '2026-13-01'],
    ['mes 00', '2026-00-10'],
    ['día 00', '2026-06-00'],
    ['31 de abril', '2026-04-31'],
    ['29-feb no bisiesto', '2026-02-29'],
    ['2100 no bisiesto (siglo no /400)', '2100-02-29'],
    ['vacío', ''],
    ['basura', 'abcd-ef-gh'],
  ])('rechaza %s (%s)', (_label, s) => {
    expect(isRealCalendarDate(s)).toBe(false);
  });
});

describe('isoCalendarDateSchema', () => {
  it('parsea una fecha real', () => {
    expect(isoCalendarDateSchema.parse('2026-06-11')).toBe('2026-06-11');
  });

  it('rechaza una fecha imposible', () => {
    expect(() => isoCalendarDateSchema.parse('2026-02-31')).toThrow();
  });
});
