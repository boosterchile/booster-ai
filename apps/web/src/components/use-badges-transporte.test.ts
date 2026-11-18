import { describe, expect, it } from 'vitest';
import { contarSinConductor } from './use-badges-transporte.js';

describe('contarSinConductor', () => {
  it('no cuenta las canceladas por el generador: no se despachan', () => {
    expect(
      contarSinConductor([
        { driver: null, status: 'asignado' },
        { driver: null, status: 'cancelado' },
        { driver: { user_id: 'u' }, status: 'asignado' },
      ]),
    ).toBe(1);
  });
});
