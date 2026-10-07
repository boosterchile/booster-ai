import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T10-03 PR 2 (ADR-082) — fase contract del retiro de la superficie demo.
 * Tras aplicar las migraciones (globalSetup corre runMigrations), el schema
 * no conserva nada del modo demo: ni `empresas.es_demo`, ni la tabla
 * `cuentas_demo`, ni el enum `persona_demo`. El expand fue el PR 1 (#745):
 * el código dejó de leer y escribir la columna y la tabla.
 */
describe('integration: schema sin superficie demo (0059)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('empresas no tiene la columna es_demo', async () => {
    const r = await handle.pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'empresas' AND column_name = 'es_demo'`,
    );
    expect(r.rowCount).toBe(0);
  });

  test('no existe la tabla cuentas_demo', async () => {
    const r = await handle.pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.cuentas_demo')::text AS t`,
    );
    expect(r.rows[0]?.t).toBeNull();
  });

  test('no existe el enum persona_demo', async () => {
    const r = await handle.pool.query(`SELECT 1 FROM pg_type WHERE typname = 'persona_demo'`);
    expect(r.rowCount).toBe(0);
  });

  test('es_usuario_prueba sigue en empresas (la marca de impersonación no se toca)', async () => {
    const r = await handle.pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'empresas' AND column_name = 'es_usuario_prueba'`,
    );
    expect(r.rowCount).toBe(1);
  });
});
