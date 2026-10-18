/**
 * Lee `code` y `constraint` de un error de node-postgres, también si Drizzle
 * lo dejó en `cause`. Sirve para traducir una carrera de UNIQUE a 409.
 */

function readStringField(err: unknown, field: 'code' | 'constraint'): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const record = err as Record<string, unknown>;
  const value = record[field];
  if (typeof value === 'string') {
    return value;
  }
  if ('cause' in record) {
    return readStringField(record.cause, field);
  }
  return undefined;
}

export function pgErrorCode(err: unknown): string | undefined {
  return readStringField(err, 'code');
}

export function pgConstraintName(err: unknown): string | undefined {
  return readStringField(err, 'constraint');
}

/** Carrera contra `uq_usuarios_rut` (migración 0058). Varios NULL no disparan esto. */
export function esRutDuplicado(err: unknown): boolean {
  return pgErrorCode(err) === '23505' && pgConstraintName(err) === 'uq_usuarios_rut';
}
