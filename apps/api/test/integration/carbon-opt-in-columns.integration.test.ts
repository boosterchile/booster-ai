import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Task 1 — verificación a nivel DB de las columnas opt-in de huella tras
 * aplicar la migración 0046 (globalSetup corre runMigrations). Complementa el
 * test unitario del contrato Drizzle (`test/unit/carbon-opt-in-columns.test.ts`)
 * con la prueba de que el SQL realmente crea las columnas en Postgres.
 */
interface ColumnRow {
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}

describe('integration: columnas opt-in de medición de huella (0046)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('empresas.carbon_measurement_enabled: boolean NOT NULL DEFAULT false', async () => {
    const result = await handle.pool.query<ColumnRow>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'empresas' AND column_name = 'carbon_measurement_enabled'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('boolean');
    expect(result.rows[0].is_nullable).toBe('NO');
    expect(result.rows[0].column_default).toContain('false');
  });

  test('viajes.carbon_measurement_override: boolean nullable sin default', async () => {
    const result = await handle.pool.query<ColumnRow>(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'viajes' AND column_name = 'carbon_measurement_override'`,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('boolean');
    expect(result.rows[0].is_nullable).toBe('YES');
    expect(result.rows[0].column_default).toBeNull();
  });
});
