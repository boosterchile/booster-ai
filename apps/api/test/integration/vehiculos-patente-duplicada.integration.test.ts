import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createVehiculosRoutes } from '../../src/routes/vehiculos.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Bug de producción 2026-10-10: editar un vehículo devolvía 500
 * `internal_server_error` en vez de 409 cuando la patente ya existía.
 * Drizzle envuelve el error de node-postgres: el `code` 23505 vive en
 * `err.cause`, y el catch leía `err.code` (undefined) → relanzaba. Los stubs
 * unitarios no reproducen el envoltorio; este test usa Postgres REAL.
 */
describe('integration: patente duplicada en vehículos → 409', () => {
  let handle: TestDbHandle;
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => logger,
  } as never;

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function fixture() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan lic ${suffix}`,
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
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes Lic ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `lic-${suffix}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId,
      })
      .returning({ id: schema.empresas.id });
    const [user] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${suffix}`,
        email: `pending-rut-${suffix}@boosterchile.invalid`,
        fullName: 'CONDUCTOR PRUEBA LICENCIA',
        // RUT único por fixture: uq_usuarios_rut (0058) rechaza repetirlo entre tests.
        rut: rutAleatorio(),
      })
      .returning({ id: schema.users.id });
    if (!empresa || !user) {
      throw new Error('fixture: empresa/user no creados');
    }
    return { empresaId: empresa.id };
  }

  function appPara(empresaId: string) {
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userContext', {
        user: { id: 'u-int', firebaseUid: 'fb-int', email: 'int@x.com' },
        memberships: [],
        activeMembership: {
          membership: { id: 'm-int', role: 'dueno' },
          empresa: { id: empresaId, legal_name: 'Transportes Lic' },
        },
      });
      await next();
    });
    app.route('/vehiculos', createVehiculosRoutes({ db: handle.db, logger }));
    return app;
  }

  const body = (plate: string) => ({
    plate,
    vehicle_type: 'camion_pesado',
    capacity_kg: 15000,
    year: 2018,
    brand: 'SCANIA',
    model: 'G440',
    fuel_type: 'diesel',
    curb_weight_kg: 10000,
  });
  const json = (payload: unknown, method: string) => ({
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  async function crear(app: Hono, plate: string): Promise<string> {
    const res = await app.request('/vehiculos', json(body(plate), 'POST'));
    expect(res.status).toBe(201);
    return ((await res.json()) as { vehicle: { id: string } }).vehicle.id;
  }

  test('PATCH con patente de otro vehículo → 409 plate_duplicate (antes: 500)', async () => {
    const f = await fixture();
    const app = appPara(f.empresaId);
    await crear(app, 'KKAA11');
    const otroId = await crear(app, 'KKAA22');
    const res = await app.request(`/vehiculos/${otroId}`, json({ plate: 'KKAA11' }, 'PATCH'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'plate_duplicate' });
  });

  test('POST con patente existente → 409 plate_duplicate (antes: 500)', async () => {
    const f = await fixture();
    const app = appPara(f.empresaId);
    await crear(app, 'KKAA33');
    const res = await app.request('/vehiculos', json(body('KKAA33'), 'POST'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'plate_duplicate' });
  });

  test('PATCH con la misma patente del propio vehículo sigue → 200', async () => {
    const f = await fixture();
    const app = appPara(f.empresaId);
    const id = await crear(app, 'KKAA44');
    const res = await app.request(
      `/vehiculos/${id}`,
      json({ plate: 'KKAA44', brand: 'VOLVO' }, 'PATCH'),
    );
    expect(res.status).toBe(200);
  });
});
