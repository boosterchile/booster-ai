import { describe, expect, it } from 'vitest';
import { esEmailDuplicado, esRutDuplicado, pgConstraintName, pgErrorCode } from './pg-error.js';

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

  it('solo el unique de email es un email duplicado', () => {
    expect(esEmailDuplicado({ code: '23505', constraint: 'usuarios_email_unique' })).toBe(true);
    expect(esEmailDuplicado({ cause: { code: '23505', constraint: 'usuarios_email_key' } })).toBe(
      true,
    );
    expect(esEmailDuplicado({ code: '23505', constraint: 'uq_usuarios_rut' })).toBe(false);
    expect(esEmailDuplicado({ code: '23505', constraint: 'usuarios_firebase_uid_key' })).toBe(
      false,
    );
    expect(esEmailDuplicado({ code: '23505' })).toBe(false);
  });
});
