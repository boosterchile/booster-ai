import { describe, expect, it } from 'vitest';
import { safeIsoString } from './safe-iso-string.js';

describe('safeIsoString', () => {
  it('serializa un Date válido', () => {
    expect(safeIsoString(new Date('2026-08-03T01:00:00Z'))).toBe('2026-08-03T01:00:00.000Z');
  });

  it('null y undefined → null', () => {
    expect(safeIsoString(null)).toBeNull();
    expect(safeIsoString(undefined)).toBeNull();
  });

  it('Date inválido → null, NO throw', () => {
    // El caso que importa: `.toISOString()` acá tira RangeError y, dentro de
    // un `c.json()`, se lleva puesta la respuesta completa con un 500.
    const roto = new Date('no-es-fecha');
    expect(() => roto.toISOString()).toThrow(RangeError);
    expect(safeIsoString(roto)).toBeNull();
  });

  it('string pasa tal cual (pg puede entregar el timestamp ya serializado)', () => {
    expect(safeIsoString('2026-08-03T01:00:00Z')).toBe('2026-08-03T01:00:00Z');
  });

  it('cualquier otro tipo → null', () => {
    expect(safeIsoString(1754179200000)).toBeNull();
    expect(safeIsoString({})).toBeNull();
  });
});
