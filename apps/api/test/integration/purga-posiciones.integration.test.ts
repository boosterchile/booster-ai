import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { purgarPosicionesMovil } from '../../src/services/purgar-posiciones-movil.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Spec feat-retencion-posiciones-movil §9 (review 2026-06-11, bloqueante):
 * el unit test verificaba substrings del SQL; este verifica la SEMÁNTICA
 * contra Postgres real — borra lo viejo pero la última posición por
 * vehículo SOBREVIVE aunque sea antigua (fallback de /flota). Una
 * mutación DESC→ASC en el service rompe ESTE test, no aquel.
 */
const noop = (): void => undefined;
const logger = { info: noop, warn: noop, error: noop, debug: noop } as never;

describe('integration: purga de posiciones_movil_conductor', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  async function fixture() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    // empresas.plan_id es NOT NULL sin default (CI lo reveló: 23502) —
    // las migraciones no seedean planes en la BD de test.
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan Purga ${suffix}`,
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
        firebaseUid: `fb-purga-${suffix}`,
        email: `purga-${suffix}@test.invalid`,
        fullName: 'Purga Test',
      })
      .returning({ id: schema.users.id });
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Purga SpA ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `empresa-${suffix}@test.invalid`,
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
    const [vehiculo] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: empresa.id,
        plate: `PU${suffix.slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
      })
      .returning({ id: schema.vehicles.id });
    if (!vehiculo) {
      throw new Error('fixture: vehiculo no creado');
    }
    return { userId: user.id, vehiculoId: vehiculo.id };
  }

  function insertPos(vehiculoId: string, userId: string, daysAgo: number) {
    return handle.db.insert(schema.posicionesMovilConductor).values({
      vehicleId: vehiculoId,
      userId,
      timestampDevice: sql`now() - make_interval(days => ${daysAgo})` as unknown as Date,
      latitude: '-33.4500000',
      longitude: '-70.6600000',
    });
  }

  test('borra >30d pero preserva la última por vehículo (aunque sea vieja)', async () => {
    const { userId, vehiculoId } = await fixture();

    // Vehículo inactivo: TODAS sus posiciones son viejas (90/60/45 días).
    await insertPos(vehiculoId, userId, 90);
    await insertPos(vehiculoId, userId, 60);
    await insertPos(vehiculoId, userId, 45);

    const result = await purgarPosicionesMovil({ db: handle.db, logger });

    expect(result.deleted).toBeGreaterThanOrEqual(2);
    const restantes = await handle.pool.query<{ dias: string }>(
      `SELECT round(extract(epoch FROM now() - timestamp_device) / 86400)::text AS dias
       FROM posiciones_movil_conductor WHERE vehiculo_id = $1`,
      [vehiculoId],
    );
    // Sobrevive EXACTAMENTE una: la más reciente (45 días — vieja pero última).
    expect(restantes.rows).toHaveLength(1);
    expect(Number(restantes.rows[0]?.dias)).toBe(45);
  });

  test('posiciones recientes (<30d) no se tocan', async () => {
    const { userId, vehiculoId } = await fixture();
    await insertPos(vehiculoId, userId, 2);
    await insertPos(vehiculoId, userId, 1);

    await purgarPosicionesMovil({ db: handle.db, logger });

    const count = await handle.pool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM posiciones_movil_conductor WHERE vehiculo_id = $1',
      [vehiculoId],
    );
    expect(Number(count.rows[0]?.n)).toBe(2);
  });
});
