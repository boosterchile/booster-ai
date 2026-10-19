import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  INDICE_GPS_VALIDO_IMEI,
  INDICE_GPS_VALIDO_VEHICULO,
  queryUltimaPosicionGpsValida,
} from '../../src/services/ultima-posicion-gps.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Migración 0066. No mide tiempo de pared: bajo coverage V8 el mismo plan
 * cambia de milisegundos. La evidencia es el plan: el índice parcial y
 * cero filas descartadas por filtro, con miles de pings 0,0 más nuevos
 * que el único fix válido.
 */
const PINGS_SIN_FIX = 3_000;

type NodoPlan = {
  'Index Name'?: string;
  'Rows Removed by Filter'?: number;
  Plan?: NodoPlan;
  Plans?: NodoPlan[];
};

function nodos(nodo: NodoPlan): NodoPlan[] {
  const hijos = [...(nodo.Plan ? [nodo.Plan] : []), ...(nodo.Plans ?? [])];
  return [nodo, ...hijos.flatMap(nodos)];
}

describe('integration: última posición válida usa el índice parcial (0066)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  test('los índices parciales existen con el predicado de coordenada válida', async () => {
    const res = await handle.pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename = 'telemetria_puntos'
         AND indexname IN ($1, $2)`,
      [INDICE_GPS_VALIDO_VEHICULO, INDICE_GPS_VALIDO_IMEI],
    );
    expect(res.rows.map((row) => row.indexname).sort()).toEqual(
      [INDICE_GPS_VALIDO_IMEI, INDICE_GPS_VALIDO_VEHICULO].sort(),
    );
    for (const row of res.rows) {
      expect(row.indexdef).toContain('timestamp_device DESC');
      expect(row.indexdef.toLowerCase()).toContain('latitud is not null');
      expect(row.indexdef.toLowerCase()).toContain('longitud is not null');
      expect(row.indexdef).toContain('<>');
    }
  });

  test('el plan no descarta los pings sin fix: salta al único fix válido', async () => {
    const f = await fixture(handle);
    await handle.pool.query(
      `INSERT INTO telemetria_puntos (
         vehiculo_id, imei, timestamp_device, prioridad, longitud, latitud, velocidad_kmh
       )
       SELECT $1::uuid, $2, timestamptz '2026-10-19 18:00:00+00' + (g * interval '1 second'),
              0, 0, 0, 0
       FROM generate_series(1, $3) AS g`,
      [f.vehicleId, f.imei, PINGS_SIN_FIX],
    );
    await handle.pool.query(
      `INSERT INTO telemetria_puntos (
         vehiculo_id, imei, timestamp_device, prioridad, longitud, latitud, velocidad_kmh
       ) VALUES ($1::uuid, $2, timestamptz '2026-10-01 12:00:00+00', 0, -70.66, -33.45, 40)`,
      [f.vehicleId, f.imei],
    );
    await handle.pool.query('ANALYZE telemetria_puntos');

    const porVehiculo = queryUltimaPosicionGpsValida(handle.db, { vehiculoId: f.vehicleId });
    const [fila] = await porVehiculo;
    expect(Number(fila?.latitude)).toBeCloseTo(-33.45, 5);
    expect(Number(fila?.longitude)).toBeCloseTo(-70.66, 5);

    const planVehiculo = await explicar(handle, porVehiculo.toSQL());
    assertPlanParcial(planVehiculo, INDICE_GPS_VALIDO_VEHICULO);

    const porImei = queryUltimaPosicionGpsValida(handle.db, { imei: f.imei });
    const planImei = await explicar(handle, porImei.toSQL());
    assertPlanParcial(planImei, INDICE_GPS_VALIDO_IMEI);
  });
});

function assertPlanParcial(plan: unknown, indice: string) {
  const raiz = Array.isArray(plan) ? plan : [plan];
  const todos = raiz.flatMap((item) => nodos(item as NodoPlan));
  const nombres = todos.map((nodo) => nodo['Index Name']).filter((nombre) => nombre != null);
  expect(nombres).toContain(indice);
  const descartadas = todos
    .map((nodo) => nodo['Rows Removed by Filter'])
    .filter((n): n is number => typeof n === 'number');
  expect(descartadas.every((n) => n === 0)).toBe(true);
}

async function explicar(
  handle: TestDbHandle,
  compiled: { sql: string; params: unknown[] },
): Promise<unknown> {
  const client = await handle.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const explain = await client.query<{ 'QUERY PLAN': unknown }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${compiled.sql}`,
      compiled.params,
    );
    return explain.rows[0]?.['QUERY PLAN'];
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function fixture(handle: TestDbHandle): Promise<{ vehicleId: string; imei: string }> {
  const { db } = handle;
  const suffix = randomUUID().slice(0, 8);
  const [plan] = await db
    .insert(schema.plans)
    .values({
      slug: 'gratis',
      name: `Plan Ubicacion ${suffix}`,
      description: 'plan de fixture para integration tests',
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
  const [user] = await db
    .insert(schema.users)
    .values({
      firebaseUid: `fb-ubicacion-${suffix}`,
      email: `ubicacion-${suffix}@test.invalid`,
      fullName: 'Ubicacion Test',
    })
    .returning({ id: schema.users.id });
  const [empresa] = await db
    .insert(schema.empresas)
    .values({
      legalName: `Ubicacion SpA ${suffix}`,
      rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
      contactEmail: `empresa-ubicacion-${suffix}@test.invalid`,
      contactPhone: '+56911111111',
      addressStreet: 'Calle Falsa 123',
      addressCity: 'Santiago',
      addressRegion: 'RM',
      isTransportista: true,
      planId,
    })
    .returning({ id: schema.empresas.id });
  if (!user || !empresa) {
    throw new Error('fixture: user/empresa no creados');
  }
  const [vehicle] = await db
    .insert(schema.vehicles)
    .values({
      empresaId: empresa.id,
      plate: `UB${suffix.slice(0, 4).toUpperCase()}`,
      vehicleType: 'camion_mediano',
      capacityKg: 5000,
    })
    .returning({ id: schema.vehicles.id });
  if (!vehicle) {
    throw new Error('fixture: vehículo no creado');
  }
  const imei = `86${suffix.replace(/\D/g, '').padEnd(13, '7').slice(0, 13)}`;
  return { vehicleId: vehicle.id, imei };
}
