import { describe, expect, it } from 'vitest';
import { esRutDuplicado, pgConstraintName, pgErrorCode } from './pg-error.js';

describe('pg-error', () => {
  it('lee code y constraint anidados en cause', () => {
    const err = { cause: { code: '23505', constraint: 'uq_usuarios_rut' } };
    expect(pgErrorCode(err)).toBe('23505');
    expect(pgConstraintName(err)).toBe('uq_usuarios_rut');
    expect(esRutDuplicado(err)).toBe(true);
  });

  it('otro unique no es un RUT duplicado', () => {
    expect(esRutDuplicado({ code: '23505', constraint: 'usuarios_email_unique' })).toBe(false);
    expect(esRutDuplicado(null)).toBe(false);
  });
});
