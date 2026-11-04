import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createConductoresRoutes } from '../../src/routes/conductores.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/** Alta de conductor con un RUT ya registrado en Booster. */

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
          empresa: {
            id: empresaId,
            legal_name: 'Transportes Int',
            isTransportista: true,
            isGeneradorCarga: false,
          },
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

  async function personaRegistrada(datos: { pin?: string; email?: string; phone?: string } = {}) {
    const rut = rutAleatorio();
    const [u] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: datos.email ?? `previa-${randomUUID().slice(0, 6)}@test.invalid`,
        fullName: 'Persona Previa',
        rut,
        phone: datos.phone ?? null,
        activationPinHash: datos.pin ?? null,
        status: 'pendiente_verificacion',
        createdAt: hace2Dias,
      })
      .returning();
    if (!u) {
      throw new Error('fixture');
    }
    return u;
  }

  async function usuario(id: string) {
    const [u] = await h.db.select().from(schema.users).where(eq(schema.users.id, id));
    return u;
  }

  async function retirar(conductorId: string) {
    const res = await app().request(`/conductores/${conductorId}`, { method: 'DELETE' });
    expect(res.status).toBeLessThan(300);
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

  test('alta con RUT registrado mantiene la respuesta y los datos de la persona', async () => {
    const p = await personaRegistrada({
      email: `pending-rut-${randomUUID().slice(0, 6)}@boosterchile.invalid`,
      phone: '+56911112222',
    });
    const r = await post('/conductores', alta(p.rut ?? ''));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toBeUndefined();
    const u = await usuario(p.id);
    expect(u?.activationPinHash).toBeNull();
    expect(u?.email).toBe(p.email);
    expect(u?.phone).toBe('+56911112222');
    expect(u?.firebaseUid).toBe(p.firebaseUid);

    const lista = await app().request('/conductores');
    const texto = JSON.stringify(await lista.json());
    expect(texto).not.toContain(p.email);
    expect(texto).not.toContain(p.rut ?? '');
    expect(texto).not.toContain('Persona Previa');
    expect(texto).not.toContain('+56911112222');
  });

  test('la ficha de una persona registrada no cambia su contacto', async () => {
    const p = await personaRegistrada({ phone: '+56911113333' });
    const r = await post('/conductores', alta(p.rut ?? ''));
    const id = r.json.conductor.id;
    const email = await post(`/conductores/${id}/email`, { email: 'nuevo@test.invalid' });
    expect(email.status).toBe(409);
    expect(email.json.activation_pin).toBeUndefined();
    const tel = await post(`/conductores/${id}/telefono`, { phone: '+56957790378' });
    expect(tel.status).toBe(409);
    expect(tel.json.activation_pin).toBeUndefined();
    const u = await usuario(p.id);
    expect(u?.email).toBe(p.email);
    expect(u?.phone).toBe('+56911113333');
    expect(u?.activationPinHash).toBeNull();
  });

  test('alta, retiro y nueva alta con RUT registrado mantienen los datos de la persona', async () => {
    const p = await personaRegistrada({ pin: 'hash-anterior', phone: '+56911114444' });
    const primera = await post('/conductores', alta(p.rut ?? ''));
    expect(primera.status).toBe(201);
    await retirar(primera.json.conductor.id);
    const segunda = await post('/conductores', alta(p.rut ?? ''));
    expect(segunda.status).toBe(200);
    expect(segunda.json.activation_pin).toBeUndefined();
    const u = await usuario(p.id);
    expect(u?.activationPinHash).toBe('hash-anterior');
    expect(u?.email).toBe(p.email);
    expect(u?.phone).toBe('+56911114444');
  });

  test('alta con RUT registrado no reemplaza ni prolonga una clave anterior', async () => {
    const p = await personaRegistrada({ pin: 'hash-anterior' });
    const r = await post('/conductores', alta(p.rut ?? ''));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toBeUndefined();
    expect((await usuario(p.id))?.activationPinHash).toBe('hash-anterior');
  });

  test('alta de RUT nuevo sigue entregando el código', async () => {
    const rutN = rutAleatorio();
    const r = await post('/conductores', alta(rutN));
    expect(r.status).toBe(201);
    expect(r.json.activation_pin).toMatch(/^\d{6}$/);
    const detalle = await app().request(`/conductores/${r.json.conductor.id}`);
    const texto = JSON.stringify(await detalle.json());
    expect(texto).not.toContain('Nombre Escrito');
    expect(texto).not.toContain(rutN);
    expect(texto).not.toContain('+56957790379');
  });

  test('alta, retiro y nueva alta de RUT nuevo entregan un código nuevo', async () => {
    const rutN = rutAleatorio();
    const r = await post('/conductores', alta(rutN));
    expect(r.json.activation_pin).toMatch(/^\d{6}$/);
    await retirar(r.json.conductor.id);
    const otra = await post('/conductores', alta(rutN));
    expect(otra.status).toBe(200);
    expect(otra.json.activation_pin).toMatch(/^\d{6}$/);
    expect(otra.json.activation_pin).not.toBe(r.json.activation_pin);
  });
});
