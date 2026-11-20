import { getTableColumns } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import { users } from '../../src/db/schema.js';

/**
 * T1 de `.specs/alta-personal-booster/spec.md` — contrato del schema (no toca
 * DB). La cuenta del personal de Booster guarda hasta cuándo vale su código de
 * activación: `/auth/activar` no tiene una invitación a empresa de la que
 * sacar la fecha. Nullable sin default: ninguna fila existente cambia.
 * Buscamos por nombre SQL para que el test compile aun antes de que la
 * columna exista (rojo limpio, no error de tipos).
 */
describe('usuarios.activacion_vence_en — columna', () => {
  test('es timestamp with time zone, nullable y sin default', () => {
    const column = Object.values(getTableColumns(users)).find(
      (c) => c.name === 'activacion_vence_en',
    );

    expect(column).toBeDefined();
    expect(column?.getSQLType()).toBe('timestamp with time zone');
    expect(column?.notNull).toBe(false);
    expect(column?.hasDefault).toBe(false);
  });
});
