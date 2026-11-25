import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createDocumentosRoutes } from '../../src/routes/documentos.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `/documentos/*` contra Postgres real. `fecha_emision` y `fecha_vencimiento`
 * son `date` en la base; con el esquema de drizzle declarándolas `timestamp`
 * llegaban como `Invalid Date` y la serialización con `toISOString` reventaba.
 * Los tests unitarios no lo veían porque el stub entrega objetos `Date` válidos.
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

describe('integration: fechas de los documentos de vehículo y conductor', () => {
  let handle: TestDbHandle;
  let empresaId = '';
  let vehiculoId = '';
  let conductorId = '';

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
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
    const s = randomUUID().slice(0, 8);
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Documentos ${s}`,
        rut: rutAleatorio(),
        contactEmail: `doc-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        status: 'activa',
        planId,
      })
      .returning({ id: schema.empresas.id });
    empresaId = empresa?.id ?? '';
    const [camion] = await db
      .insert(schema.vehicles)
      .values({
        empresaId,
        plate: `DO${randomUUID().slice(0, 8).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
      })
      .returning({ id: schema.vehicles.id });
    vehiculoId = camion?.id ?? '';
    const [usuario] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `doc-${s}`,
        email: `doc-${s}@usuario.invalid`,
        fullName: 'Conductora Documentos',
        rut: rutAleatorio(),
        status: 'activo',
      })
      .returning({ id: schema.users.id });
    const [conductor] = await db
      .insert(schema.conductores)
      .values({
        userId: usuario?.id ?? '',
        empresaId,
        licenseClass: 'A5',
        licenseNumber: `L-${s}`,
        licenseExpiry: '2027-06-01',
      })
      .returning({ id: schema.conductores.id });
    conductorId = conductor?.id ?? '';
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  function app() {
    const a = new Hono();
    a.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'u-1', firebaseUid: 'fb-1', email: 'dueno@empresa.invalid' },
        memberships: [],
        activeMembership: {
          membership: { id: 'm-1', role: 'dueno' },
          empresa: { id: empresaId, legal_name: 'Documentos' },
        },
      });
      await next();
    });
    a.route('/documentos', createDocumentosRoutes({ db: handle.db, logger }));
    return a;
  }

  const enviar = (ruta: string, metodo: 'POST' | 'PATCH', cuerpo: unknown) =>
    app().request(ruta, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

  test('vehículo: crear, listar y editar devuelven las fechas tal como se guardaron', async () => {
    const creado = await enviar(`/documentos/vehiculo/${vehiculoId}`, 'POST', {
      tipo: 'soap',
      fecha_emision: '2026-03-15',
      fecha_vencimiento: '2027-03-15',
    });
    expect(creado.status).toBe(201);
    const { documento } = (await creado.json()) as {
      documento: { id: string; fecha_emision: string; fecha_vencimiento: string };
    };
    expect(documento).toMatchObject({
      fecha_emision: '2026-03-15',
      fecha_vencimiento: '2027-03-15',
    });

    const lista = await app().request(`/documentos/vehiculo/${vehiculoId}`);
    expect(lista.status).toBe(200);
    const { documentos } = (await lista.json()) as {
      documentos: Array<{ id: string; fecha_vencimiento: string; estado: string }>;
    };
    expect(documentos.find((d) => d.id === documento.id)).toMatchObject({
      fecha_vencimiento: '2027-03-15',
      estado: 'vigente',
    });

    const editado = await enviar(`/documentos/vehiculo-doc/${documento.id}`, 'PATCH', {
      fecha_vencimiento: '2020-01-31',
    });
    expect(editado.status).toBe(200);
    expect(
      ((await editado.json()) as { documento: { fecha_vencimiento: string; estado: string } })
        .documento,
    ).toMatchObject({ fecha_vencimiento: '2020-01-31', estado: 'vencido' });
  });

  test('conductor: crear, listar y editar devuelven las fechas tal como se guardaron', async () => {
    const creado = await enviar(`/documentos/conductor/${conductorId}`, 'POST', {
      tipo: 'examen_psicotecnico',
      fecha_emision: '2026-02-01',
      fecha_vencimiento: '2028-02-01',
    });
    expect(creado.status).toBe(201);
    const { documento } = (await creado.json()) as {
      documento: { id: string; fecha_emision: string; fecha_vencimiento: string };
    };
    expect(documento).toMatchObject({
      fecha_emision: '2026-02-01',
      fecha_vencimiento: '2028-02-01',
    });

    const lista = await app().request(`/documentos/conductor/${conductorId}`);
    expect(lista.status).toBe(200);
    const { documentos } = (await lista.json()) as {
      documentos: Array<{ id: string; fecha_vencimiento: string }>;
    };
    expect(documentos.find((d) => d.id === documento.id)?.fecha_vencimiento).toBe('2028-02-01');

    const editado = await enviar(`/documentos/conductor-doc/${documento.id}`, 'PATCH', {
      fecha_emision: null,
    });
    expect(editado.status).toBe(200);
    expect(
      ((await editado.json()) as { documento: { fecha_emision: string | null } }).documento
        .fecha_emision,
    ).toBeNull();
  });
});
