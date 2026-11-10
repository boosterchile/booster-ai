import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { getPublicTracking } from '../../src/services/get-public-tracking.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/seguimiento-enlace-destinatario/` §3.1 contra Postgres real: al
 * cambiar el contacto del destinatario el enlace público cambia; el anterior
 * deja de resolver y el nuevo resuelve.
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

describe('integration: enlace de seguimiento al cambiar el destinatario', () => {
  let handle: TestDbHandle;
  let app: Hono;
  let generadora: typeof schema.empresas.$inferSelect;
  let transportista: typeof schema.empresas.$inferSelect;
  let dueno: typeof schema.users.$inferSelect;
  let conductor: typeof schema.users.$inferSelect;
  let vehiculo: typeof schema.vehicles.$inferSelect;

  function uno<T>(rows: T[]): T {
    const r = rows[0];
    if (!r) {
      throw new Error('fixture no creado');
    }
    return r;
  }

  async function planId(): Promise<string> {
    const [plan] = await handle.db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan enlace',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const id =
      plan?.id ??
      (await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  async function empresa(tag: string, generador: boolean) {
    const suffix = randomUUID().slice(0, 8);
    return uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: `${tag} ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `${tag}-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: !generador,
          isGeneradorCarga: generador,
          status: 'activa',
          planId: await planId(),
        })
        .returning(),
    );
  }

  async function usuario(nombre: string) {
    const suffix = randomUUID().slice(0, 8);
    return uno(
      await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `${suffix}@test.invalid`,
          fullName: nombre,
          rut: rutAleatorio(),
        })
        .returning(),
    );
  }

  /** Viaje asignado con destinatario y enlace público acuñado. */
  async function viajeConEnlace(destinatario: { telefono: string | null; correo: string | null }) {
    const v = uno(
      await handle.db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generadora.id,
          createdByUserId: dueno.id,
          originAddressRaw: 'A',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
          consigneeName: 'Bodega',
          consigneeWhatsappE164: destinatario.telefono,
          consigneeEmail: destinatario.correo,
        })
        .returning(),
    );
    const o = uno(
      await handle.db
        .insert(schema.offers)
        .values({
          tripId: v.id,
          empresaId: transportista.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning(),
    );
    const token = randomUUID();
    const a = uno(
      await handle.db
        .insert(schema.assignments)
        .values({
          tripId: v.id,
          offerId: o.id,
          empresaId: transportista.id,
          vehicleId: vehiculo.id,
          driverUserId: conductor.id,
          agreedPriceClp: 100_000,
          status: 'asignado',
          acceptedAt: new Date(),
          publicTrackingToken: token,
        })
        .returning(),
    );
    return { v, a, token };
  }

  const editar = (id: string, body: unknown) =>
    app.request(`/trip-requests-v2/${id}/datos-libres`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function tokenVigente(assignmentId: string): Promise<string | null> {
    const [fila] = await handle.db
      .select({ token: schema.assignments.publicTrackingToken })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignmentId));
    return fila?.token ?? null;
  }

  const resuelve = async (token: string) =>
    (await getPublicTracking({ db: handle.db, logger, token })).status;

  beforeAll(async () => {
    handle = createTestDb();
    const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
    generadora = await empresa('Generadora', true);
    transportista = await empresa('Transportista', false);
    dueno = await usuario('Dueña Generadora');
    conductor = await usuario('Conductor Uno');
    vehiculo = uno(
      await handle.db
        .insert(schema.vehicles)
        .values({
          empresaId: transportista.id,
          plate: `EN${randomUUID().slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
    );
    const membresia = uno(
      await handle.db
        .insert(schema.memberships)
        .values({
          userId: dueno.id,
          empresaId: generadora.id,
          role: 'dueno',
          status: 'activa',
          joinedAt: new Date(),
        })
        .returning(),
    );
    const ctx: UserContext = {
      user: dueno,
      memberships: [{ membership: membresia, empresa: generadora }],
      activeMembership: { membership: membresia, empresa: generadora },
      impersonatedBy: null,
    };
    app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userContext', ctx);
      await next();
    });
    app.route('/trip-requests-v2', createTripRequestsV2Routes({ db: handle.db, logger }));
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('cambia el teléfono: el enlace anterior deja de resolver y el nuevo resuelve', async () => {
    const { v, a, token } = await viajeConEnlace({ telefono: '+56911111111', correo: null });
    expect(await resuelve(token)).toBe('found');

    const r = await editar(v.id, { consignee: { name: 'Bodega', phone_e164: '+56922222222' } });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      trip_request: { id: v.id, campos: ['consignee'], enlace_seguimiento_renovado: true },
    });

    const nuevo = await tokenVigente(a.id);
    expect(nuevo).not.toBeNull();
    expect(nuevo).not.toBe(token);
    expect(await resuelve(token)).toBe('not_found');
    expect(await resuelve(nuevo ?? '')).toBe('found');
  });

  test('quitar el destinatario también cambia el enlace', async () => {
    const { v, a, token } = await viajeConEnlace({
      telefono: null,
      correo: 'recepcion@cliente.cl',
    });
    const r = await editar(v.id, { consignee: null });
    expect(r.status).toBe(200);
    expect(await tokenVigente(a.id)).not.toBe(token);
    expect(await resuelve(token)).toBe('not_found');
  });

  test('cambiar solo el nombre o las notas deja el enlace igual', async () => {
    const { v, a, token } = await viajeConEnlace({ telefono: '+56911111111', correo: null });
    const r = await editar(v.id, {
      consignee: { name: 'Bodega Norte', phone_e164: '+56911111111' },
      notes: 'Andén 4',
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      trip_request: { enlace_seguimiento_renovado: false },
    });
    expect(await tokenVigente(a.id)).toBe(token);
    expect(await resuelve(token)).toBe('found');
  });
});
