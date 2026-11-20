import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
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
 *
 * Los tests 3 y 4 leen el plan de ejecución, y el plan depende de las
 * estadísticas de `vehiculos`. Esas estadísticas las deja lo que hayan
 * insertado o borrado los tests anteriores y el momento en que pasó el
 * autovacuum: con la tabla vacía y analizada, el planner prefiere
 * `idx_vehiculos_estado` más un Sort, y el test fallaba de forma intermitente
 * (run 42989516880). Por eso cada uno siembra su propia flota, la analiza y
 * la deshace: el plan que se examina no depende de quién corrió antes.
 *
 * La flota sembrada hace que el compuesto gane por mucho y no por un margen
 * de costo: la empresa consultada tiene pocos vehículos entre miles de otra,
 * todos activos. Llegar por `idx_vehiculos_estado` obliga a leerlos todos.
 */
const VEHICULOS_DE_LA_EMPRESA = 20;
const VEHICULOS_DE_OTRA = 2_000;

describe('integration: índice de matching de vehículos (migración 0041)', () => {
  let handle: TestDbHandle;

  let empresaId: string;
  let otraEmpresaId: string;

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const crearEmpresa = async (nombre: string) => {
      const [empresa] = await db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa índice ${nombre} ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `idx-${nombre}-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id });
      if (!empresa) {
        throw new Error('fixture: empresa no creada');
      }
      return empresa.id;
    };
    empresaId = await crearEmpresa('consultada');
    otraEmpresaId = await crearEmpresa('otra');
  });

  /**
   * Corre `consulta` bajo EXPLAIN con una flota conocida y estadísticas
   * frescas, y devuelve el plan. Todo se deshace al terminar.
   */
  async function planCon(consulta: string): Promise<string> {
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      const sembrar = (empresa: string, prefijo: string, cuantos: number) =>
        client.query(
          `INSERT INTO vehiculos (empresa_id, patente, tipo_vehiculo, capacidad_kg)
           SELECT $1::uuid, $2 || lpad(i::text, 4, '0'), 'camion_mediano', 1000 + i
           FROM generate_series(1, $3::int) AS i`,
          [empresa, prefijo, cuantos],
        );
      await sembrar(otraEmpresaId, 'ZQ', VEHICULOS_DE_OTRA);
      await sembrar(empresaId, 'ZX', VEHICULOS_DE_LA_EMPRESA);
      await client.query('ANALYZE vehiculos');
      // enable_seqscan=off aísla "¿este índice es usable para esta forma de
      // query?": descartado el seqscan, el plan debe apoyarse en el compuesto.
      await client.query('SET LOCAL enable_seqscan = off');
      const explain = await client.query<{ 'QUERY PLAN': unknown }>(
        `EXPLAIN (FORMAT JSON) ${consulta}`,
        [empresaId],
      );
      return JSON.stringify(explain.rows[0]?.['QUERY PLAN']);
    } finally {
      await client.query('ROLLBACK');
      // ANALYZE actualiza `pg_class` fuera de la transacción: se repite para
      // no dejarle a los demás tests estadísticas de filas que ya no existen.
      await client.query('ANALYZE vehiculos');
      client.release();
    }
  }

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
    const plan = await planCon(
      `SELECT * FROM vehiculos
       WHERE empresa_id IN ($1::uuid)
         AND estado_vehiculo = 'activo'
         AND capacidad_kg >= 1000
       ORDER BY capacidad_kg, id`,
    );
    expect(plan).toContain('idx_vehiculos_empresa_estado_capacidad');
    expect(plan).toMatch(/Index (Only )?Scan|Bitmap Index Scan/);
  });

  test('4: una query por empresa_id solo usa el prefijo del compuesto (justifica el drop)', async () => {
    const plan = await planCon('SELECT * FROM vehiculos WHERE empresa_id = $1::uuid');
    // El standalone idx_vehiculos_empresa fue dropeado; el prefijo del
    // compuesto debe seguir cubriendo el acceso por empresa_id solo.
    expect(plan).toContain('idx_vehiculos_empresa_estado_capacidad');
  });
});
