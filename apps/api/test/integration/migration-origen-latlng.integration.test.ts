import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Task 2 — verificación a nivel DB de las columnas lat/lng del origen del
 * viaje tras aplicar la migración 0054 (globalSetup corre runMigrations).
 * Complementa el test unitario del contrato Drizzle
 * (`test/unit/origin-latlng-columns.test.ts`) con la prueba de que el SQL
 * realmente crea las columnas en Postgres con la precisión exacta.
 *
 * Nota: `trips` (const Drizzle) mapea a la tabla SQL `viajes`.
 */
interface ColumnRow {
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
  column_default: string | null;
}

const COLUMN_QUERY = `SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default
     FROM information_schema.columns
    WHERE table_name = 'viajes' AND column_name = $1`;

describe('integration: columnas lat/lng del origen del viaje (0054)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('viajes.origin_latitude: numeric(10,7) nullable sin default', async () => {
    const result = await handle.pool.query<ColumnRow>(COLUMN_QUERY, ['origin_latitude']);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].numeric_precision).toBe(10);
    expect(result.rows[0].numeric_scale).toBe(7);
    expect(result.rows[0].is_nullable).toBe('YES');
    expect(result.rows[0].column_default).toBeNull();
  });

  test('viajes.origin_longitude: numeric(10,7) nullable sin default', async () => {
    const result = await handle.pool.query<ColumnRow>(COLUMN_QUERY, ['origin_longitude']);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data_type).toBe('numeric');
    expect(result.rows[0].numeric_precision).toBe(10);
    expect(result.rows[0].numeric_scale).toBe(7);
    expect(result.rows[0].is_nullable).toBe('YES');
    expect(result.rows[0].column_default).toBeNull();
  });
});
