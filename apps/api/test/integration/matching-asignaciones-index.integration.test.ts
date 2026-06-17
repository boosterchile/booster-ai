import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Audit P1-K — migración 0042.
 *
 * Igual que 0041 (índice de vehículos), un índice no cambia la corrección de
 * la query sino el plan; el rigor es assertar el ESTADO DEL ESQUEMA que deja la
 * migración y que el PLANNER honra la decisión de diseño:
 *
 *   1. idx_asignaciones_empresa_entregado existe sobre `asignaciones` con las
 *      columnas en el orden (empresa_id, entregado_en).
 *   2. idx_asignaciones_empresa (single-column, redundante) ya NO existe.
 *   3. La query del histórico 7d de matching v2 usa el índice compuesto.
 *   4. Una query por empresa_id solo TAMBIÉN lo usa (prueba que el prefijo
 *      cubre al standalone dropeado → justifica el drop, no es regresión).
 *
 * Migraciones aplicadas por el globalSetup (runMigrations real de prod).
 */
describe('integration: índice de matching v2 de asignaciones (migración 0042)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('1: idx_asignaciones_empresa_entregado existe con las columnas en orden', async () => {
    const res = await handle.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'asignaciones'
         AND indexname = 'idx_asignaciones_empresa_entregado'`,
    );
    expect(res.rowCount).toBe(1);
    expect(res.rows[0].indexdef).toContain('(empresa_id, entregado_en)');
  });

  test('2: idx_asignaciones_empresa (single-column redundante) ya no existe', async () => {
    const res = await handle.pool.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'asignaciones'
         AND indexname = 'idx_asignaciones_empresa'`,
    );
    expect(res.rowCount).toBe(0);
  });

  test('3: la query del histórico 7d usa el índice compuesto', async () => {
    // enable_seqscan=off aísla "¿este índice es usable para esta forma de
    // query?" sin depender del volumen de datos (en tabla chica el planner
    // elegiría seqscan por costo, lo que NO es evidencia contra el índice).
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT empresa_id, count(*)
         FROM asignaciones
         WHERE empresa_id IN ('00000000-0000-0000-0000-000000000001'::uuid)
           AND entregado_en >= now() - interval '7 days'
         GROUP BY empresa_id`,
      );
      const plan = JSON.stringify(explain.rows[0]['QUERY PLAN']);
      expect(plan).toContain('idx_asignaciones_empresa_entregado');
      expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('4: una query por empresa_id solo usa el prefijo del compuesto (justifica el drop)', async () => {
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT * FROM asignaciones
         WHERE empresa_id = '00000000-0000-0000-0000-000000000001'::uuid`,
      );
      const plan = JSON.stringify(explain.rows[0]['QUERY PLAN']);
      expect(plan).toContain('idx_asignaciones_empresa_entregado');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
