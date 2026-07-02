import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Rama perf/matching-n1-and-index — migración 0041.
 *
 * Un índice no cambia la corrección de la query, solo el plan de ejecución;
 * por eso el rigor acá NO es un test funcional (pasaría con y sin índice) sino
 * assertar el ESTADO DEL ESQUEMA que deja la migración y que el PLANNER honra
 * la decisión de diseño:
 *
 *   1. idx_vehiculos_empresa_estado_capacidad existe sobre `vehiculos` con las
 *      columnas en el orden (empresa_id, estado_vehiculo, capacidad_kg, id).
 *   2. idx_vehiculos_empresa (single-column, redundante) ya NO existe.
 *   3. La query objetivo del hot path usa el índice compuesto.
 *   4. Una query por empresa_id solo TAMBIÉN lo usa (prueba que el prefijo
 *      cubre al standalone dropeado → justifica el drop, no es regresión).
 *
 * Las migraciones ya están aplicadas por el globalSetup (runMigrations real de
 * prod) antes del primer test.
 */
describe('integration: índice de matching de vehículos (migración 0041)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('1: idx_vehiculos_empresa_estado_capacidad existe con las columnas en orden', async () => {
    const res = await handle.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'vehiculos'
         AND indexname = 'idx_vehiculos_empresa_estado_capacidad'`,
    );
    expect(res.rowCount).toBe(1);
    // El orden de columnas es parte del contrato: habilita igualdad sobre
    // empresa_id + estado_vehiculo, rango sobre capacidad_kg y el orden
    // (capacidad_kg, id) del best-fit. pg_get_indexdef las emite en orden.
    expect(res.rows[0].indexdef).toContain('(empresa_id, estado_vehiculo, capacidad_kg, id)');
  });

  test('2: idx_vehiculos_empresa (single-column redundante) ya no existe', async () => {
    const res = await handle.pool.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'vehiculos'
         AND indexname = 'idx_vehiculos_empresa'`,
    );
    expect(res.rowCount).toBe(0);
  });

  test('3: la query del hot path usa el índice compuesto', async () => {
    // enable_seqscan=off aísla "¿este índice es usable para esta forma de
    // query?" sin depender del volumen de datos: en una tabla chica el planner
    // elegiría seqscan por costo, lo que NO es evidencia contra el índice.
    // Probamos que, descartado el seqscan, el plan se apoya en el compuesto.
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT * FROM vehiculos
         WHERE empresa_id IN ('00000000-0000-0000-0000-000000000001'::uuid)
           AND estado_vehiculo = 'activo'
           AND capacidad_kg >= 1000
         ORDER BY capacidad_kg, id`,
      );
      const plan = JSON.stringify(explain.rows[0]['QUERY PLAN']);
      expect(plan).toContain('idx_vehiculos_empresa_estado_capacidad');
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
         SELECT * FROM vehiculos
         WHERE empresa_id = '00000000-0000-0000-0000-000000000001'::uuid`,
      );
      const plan = JSON.stringify(explain.rows[0]['QUERY PLAN']);
      // El standalone idx_vehiculos_empresa fue dropeado; el prefijo del
      // compuesto debe seguir cubriendo el acceso por empresa_id solo.
      expect(plan).toContain('idx_vehiculos_empresa_estado_capacidad');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
