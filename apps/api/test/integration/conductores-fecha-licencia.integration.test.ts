import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createConductoresRoutes } from '../../src/routes/conductores.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Bug de producción 2026-09-14: `GET /conductores/:id` devolvía 500 para todos
 * los conductores. Causa: `licencia_vencimiento` es DATE en Postgres (migración
 * 0021) pero el schema Drizzle la declaraba `timestamp` → el driver entrega
 * "2028-09-22", Drizzle le pega "+0000" y produce un Date inválido →
 * `.toISOString()` lanza. Este test lo prueba contra Postgres REAL: los stubs
 * unitarios no pueden reproducir el mapeo del driver.
 */
describe('integration: detalle de conductor con licencia_vencimiento DATE', () => {
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
        rut: '5864136-7',
      })
      .returning({ id: schema.users.id });
    if (!empresa || !user) {
      throw new Error('fixture: empresa/user no creados');
    }
    // INSERT por SQL crudo, a propósito: la fila queda escrita con la columna
    // DATE real de Postgres, independiente de cómo la declare Drizzle.
    const conductorId = randomUUID();
    await db.execute(sql`
      INSERT INTO conductores (id, usuario_id, empresa_id, licencia_clase, licencia_numero, licencia_vencimiento, es_extranjero, estado_conductor)
      VALUES (${conductorId}, ${user.id}, ${empresa.id}, 'A4', '91657051', '2028-09-22', false, 'activo')
    `);
    return { empresaId: empresa.id, conductorId };
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
    app.route('/conductores', createConductoresRoutes({ db: handle.db, logger }));
    return app;
  }

  test('GET /conductores/:id → 200 con license_expiry "2028-09-22" (antes: 500 por Date inválido)', async () => {
    const f = await fixture();
    const app = appPara(f.empresaId);
    const res = await app.request(`/conductores/${f.conductorId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conductor: { license_expiry: string | null } };
    expect(body.conductor.license_expiry).toBe('2028-09-22');
  });

  test('GET /conductores (lista) → license_expiry ya no es null: el vencimiento vuelve a verse', async () => {
    const f = await fixture();
    const app = appPara(f.empresaId);
    const res = await app.request('/conductores');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conductores: Array<{ license_expiry: string | null }> };
    expect(body.conductores).toHaveLength(1);
    expect(body.conductores[0]?.license_expiry).toBe('2028-09-22');
  });
});
