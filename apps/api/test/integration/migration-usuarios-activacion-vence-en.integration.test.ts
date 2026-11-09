import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T1 de `.specs/alta-personal-booster/spec.md` — verificación a nivel DB de
 * `usuarios.activacion_vence_en` tras aplicar la migración 0073 (globalSetup
 * corre runMigrations). Complementa el test unitario del contrato Drizzle
 * (`test/unit/usuarios-activacion-vence-en-columns.test.ts`).
 */
interface ColumnRow {
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

describe('integration: columna usuarios.activacion_vence_en (0073)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('usuarios.activacion_vence_en: timestamptz nullable sin default', async () => {
    const result = await handle.pool.query<ColumnRow>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'usuarios' AND column_name = 'activacion_vence_en'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('timestamp with time zone');
    expect(result.rows[0].is_nullable).toBe('YES');
    expect(result.rows[0].column_default).toBeNull();
  });
});
