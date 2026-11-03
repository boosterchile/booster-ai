import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createConductoresRoutes } from '../../src/routes/conductores.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Alta de conductor con un RUT que ya existe: no expone credenciales ni datos
 * de contacto de la persona.
 */

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

describe('integration: alta de conductor con RUT existente', () => {
  let h: TestDbHandle;
  let empresaId = '';
  const hace2Dias = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  function app() {
    const a = new Hono();
    a.use('*', async (c, next) => {
      c.set('userContext', {
        user: { id: 'u-int', firebaseUid: 'fb-int', email: 'int@x.com' },
        memberships: [],
        activeMembership: {
          membership: { id: 'm-int', role: 'dueno' },
          empresa: { id: empresaId, legal_name: 'Transportes Int' },
        },
      } as never);
      await next();
    });
    a.route('/conductores', createConductoresRoutes({ db: h.db, logger }));
    return a;
  }

  async function post(path: string, body: unknown) {
    const res = await app().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  }

  async function personaPrevia(pin: string | null) {
    const rut = rutAleatorio();
    const [u] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `previa-${randomUUID().slice(0, 6)}@test.invalid`,
        fullName: 'Persona Previa',
        rut,
        activationPinHash: pin,
        status: 'pendiente_verificacion',
        createdAt: hace2Dias,
      })
      .returning();
    if (!u) {
      throw new Error('fixture');
    }
    return u;
  }

  function alta(rut: string) {
    return {
      rut,
      full_name: 'Nombre Escrito',
      phone: '+56957790379',
      email: `escrito-${randomUUID().slice(0, 6)}@test.invalid`,
      license_class: 'A5',
      license_number: 'LIC-1',
      license_expiry: '2027-12-31',
    };
  }

  beforeAll(async () => {
    h = createTestDb();
    await h.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'p', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await h.db.select().from(schema.plans).where(eq(schema.plans.slug, 'gratis'));
    const [empresa] = await h.db
      .insert(schema.empresas)
      .values({
        legalName: 'Transportes Int SpA',
        rut: rutAleatorio(),
        contactEmail: `e-${randomUUID().slice(0, 6)}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: false,
        status: 'activa',
        planId: plan?.id ?? '',
      })
      .returning();
    empresaId = empresa?.id ?? '';
  });
  afterAll(async () => {
    await h.pool.end();
  });

  test('alta de RUT existente sin credencial no expone credenciales ni datos de contacto', async () => {
    const p = await personaPrevia(null);
    const r = await post('/conductores', alta(p.rut ?? ''));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toBeUndefined();

    const tel = await post(`/conductores/${r.json.conductor.id}/telefono`, {
      phone: '+56957790378',
    });
    expect(tel.status).toBe(200);
    expect(tel.json.activation_pin).toBeUndefined();

    const [u] = await h.db.select().from(schema.users).where(eq(schema.users.id, p.id));
    expect(u?.activationPinHash).toBeNull();

    const lista = await app().request('/conductores');
    const texto = JSON.stringify(await lista.json());
    expect(texto).not.toContain(p.email);
    expect(texto).not.toContain(p.rut ?? '');
  });

  test('alta de RUT existente no reemplaza ni prolonga una credencial anterior', async () => {
    const p = await personaPrevia('hash-anterior');
    const r = await post('/conductores', alta(p.rut ?? ''));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toBeUndefined();
    const [u] = await h.db.select().from(schema.users).where(eq(schema.users.id, p.id));
    expect(u?.activationPinHash).toBe('hash-anterior');
  });

  test('alta de RUT nuevo sigue entregando el código', async () => {
    const r = await post('/conductores', alta(rutAleatorio()));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toMatch(/^\d{6}$/);
  });
});
