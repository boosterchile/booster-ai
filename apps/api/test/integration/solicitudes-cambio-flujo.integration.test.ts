import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas PR7 contra Postgres real (§6.3–6.5, §6.9–6.13): una
 * solicitud bloquea la recogida hasta que el transportista responde; aceptar
 * aplica el cambio, rechazar y retirar lo descartan, y cancelar lo invalida.
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

describe('integration: solicitudes de cambio de una carga asignada', () => {
  let handle: TestDbHandle;
  let app: Hono;
  let appTransportista: Hono;
  let appConductor: Hono;
  let duenoT: typeof schema.users.$inferSelect;
  let generadora: typeof schema.empresas.$inferSelect;
  let dueno: typeof schema.users.$inferSelect;
  let transportista: typeof schema.empresas.$inferSelect;
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
        name: 'Plan cancelar',
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
    const plan = await planId();
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
          planId: plan,
        })
        .returning(),
    );
  }

  async function usuario(nombre: string, extra: Partial<typeof schema.users.$inferInsert> = {}) {
    const suffix = randomUUID().slice(0, 8);
    return uno(
      await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `${suffix}@test.invalid`,
          fullName: nombre,
          rut: rutAleatorio(),
          ...extra,
        })
        .returning(),
    );
  }

  async function viaje(status: string) {
    return uno(
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
          status: status as never,
        })
        .returning(),
    );
  }

  async function oferta(tripId: string) {
    return uno(
      await handle.db
        .insert(schema.offers)
        .values({
          tripId,
          empresaId: transportista.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning(),
    );
  }

  async function viajeAsignado(status: 'asignado' | 'en_proceso' = 'asignado') {
    const v = await viaje(status);
    const o = await oferta(v.id);
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
          status: status === 'asignado' ? 'asignado' : 'recogido',
          acceptedAt: new Date(),
        })
        .returning(),
    );
    return { v, a };
  }

  beforeAll(async () => {
    handle = createTestDb();
    const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
    const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
    generadora = await empresa('Generadora', true);
    transportista = await empresa('Transportista', false);
    dueno = await usuario('Dueña Generadora');
    conductor = await usuario('Conductor Uno', { whatsappE164: '+56977777777' });
    vehiculo = uno(
      await handle.db
        .insert(schema.vehicles)
        .values({
          empresaId: transportista.id,
          plate: `CC${randomUUID().slice(0, 4).toUpperCase()}`,
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

    duenoT = await usuario('Dueño Transportista');
    const membresiaT = uno(
      await handle.db
        .insert(schema.memberships)
        .values({
          userId: duenoT.id,
          empresaId: transportista.id,
          role: 'dueno',
          status: 'activa',
          joinedAt: new Date(),
        })
        .returning(),
    );
    const membresiaC = uno(
      await handle.db
        .insert(schema.memberships)
        .values({
          userId: conductor.id,
          empresaId: transportista.id,
          role: 'conductor',
          status: 'activa',
          joinedAt: new Date(),
        })
        .returning(),
    );
    const routerPara = (user: typeof schema.users.$inferSelect, membership: typeof membresiaT) => {
      const a = new Hono();
      a.use('*', async (c, next) => {
        c.set('userContext', {
          user,
          memberships: [{ membership, empresa: transportista }],
          activeMembership: { membership, empresa: transportista },
          impersonatedBy: null,
        });
        await next();
      });
      a.route('/assignments', createAssignmentsRoutes({ db: handle.db, logger }));
      return a;
    };
    appTransportista = routerPara(duenoT, membresiaT);
    appConductor = routerPara(conductor, membresiaC);
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const proponer = (tripId: string, cambios: unknown) =>
    app.request(`/trip-requests-v2/${tripId}/solicitudes-cambio`, json('POST', { cambios }));
  const responder = (
    asgId: string,
    solId: string,
    accion: 'aceptar' | 'rechazar',
    body?: unknown,
  ) =>
    appTransportista.request(
      `/assignments/${asgId}/solicitudes-cambio/${solId}/${accion}`,
      json('POST', body ?? {}),
    );
  const recoger = (asgId: string) =>
    appConductor.request(`/assignments/${asgId}/confirmar-recogida`, { method: 'PATCH' });
  async function eventos(tripId: string) {
    const filas = await handle.db
      .select({ tipo: schema.tripEvents.eventType, payload: schema.tripEvents.payload })
      .from(schema.tripEvents)
      .where(eq(schema.tripEvents.tripId, tripId))
      .orderBy(schema.tripEvents.recordedAt);
    return filas;
  }
  async function solicitud(id: string) {
    const [s] = await handle.db
      .select()
      .from(schema.tripChangeRequests)
      .where(eq(schema.tripChangeRequests.id, id));
    return s;
  }

  test('proponer → la recogida queda bloqueada → aceptar aplica el cambio y la desbloquea', async () => {
    const { v, a } = await viajeAsignado();
    const r = await proponer(v.id, { weight_kg: 2500, description: 'Pallets' });
    expect(r.status).toBe(201);
    const { solicitud: s } = (await r.json()) as { solicitud: { id: string; cambios: unknown } };
    expect(s.cambios).toEqual({ weight_kg: 2500, description: 'Pallets' });

    // El detalle de cada lado.
    const detalleGen = (await (await app.request(`/trip-requests-v2/${v.id}`)).json()) as {
      trip_request: {
        cambio_pendiente: { id: string } | null;
        acciones_permitidas: Record<string, boolean>;
      };
    };
    expect(detalleGen.trip_request.cambio_pendiente?.id).toBe(s.id);
    expect(detalleGen.trip_request.acciones_permitidas).toMatchObject({
      solicitar_cambio: false,
      retirar_cambio: true,
    });
    const detalleCond = (await (await appConductor.request(`/assignments/${a.id}`)).json()) as {
      trip_request: { cambio_pendiente: unknown };
    };
    expect(detalleCond.trip_request.cambio_pendiente).toEqual({
      existe: true,
      creado_en: expect.any(String),
    });

    // Una segunda propuesta choca con la vigente.
    expect((await proponer(v.id, { weight_kg: 3000 })).status).toBe(409);

    const bloqueada = await recoger(a.id);
    expect(bloqueada.status).toBe(409);
    expect(await bloqueada.json()).toMatchObject({ code: 'cambio_pendiente', solicitud_id: s.id });

    const ok = await responder(a.id, s.id, 'aceptar');
    expect(ok.status).toBe(200);
    const [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb).toMatchObject({ cargoWeightKg: 2500, cargoDescription: 'Pallets' });
    expect(await solicitud(s.id)).toMatchObject({
      status: 'aceptada',
      respondedByUserId: duenoT.id,
    });
    expect((await eventos(v.id)).map((e) => e.tipo)).toEqual(
      expect.arrayContaining(['cambio_solicitado', 'cambio_respondido', 'carga_editada']),
    );

    expect((await recoger(a.id)).status).toBe(200);
  });

  test('rechazar deja el viaje intacto y desbloquea la recogida', async () => {
    const { v, a } = await viajeAsignado();
    const { solicitud: s } = (await (await proponer(v.id, { weight_kg: 1500 })).json()) as {
      solicitud: { id: string };
    };
    const r = await responder(a.id, s.id, 'rechazar', { reason: 'No cabe' });
    expect(r.status).toBe(200);
    const [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb?.cargoWeightKg).toBe(1000);
    expect(await solicitud(s.id)).toMatchObject({ status: 'rechazada', responseReason: 'No cabe' });
    expect((await recoger(a.id)).status).toBe(200);
  });

  test('el generador retira la propuesta; ya no se puede aceptar', async () => {
    const { v, a } = await viajeAsignado();
    const { solicitud: s } = (await (await proponer(v.id, { weight_kg: 1500 })).json()) as {
      solicitud: { id: string };
    };
    const r = await app.request(
      `/trip-requests-v2/${v.id}/solicitudes-cambio/${s.id}/retirar`,
      json('POST'),
    );
    expect(r.status).toBe(200);
    expect((await responder(a.id, s.id, 'aceptar')).status).toBe(409);
    const historial = (await (
      await app.request(`/trip-requests-v2/${v.id}/solicitudes-cambio`)
    ).json()) as { solicitudes: Array<{ estado: string }> };
    expect(historial.solicitudes.map((x) => x.estado)).toEqual(['retirada']);
  });

  test('un peso sobre la capacidad del vehículo se propone pero no se acepta (422, sigue pendiente)', async () => {
    const { v, a } = await viajeAsignado();
    const { solicitud: s } = (await (await proponer(v.id, { weight_kg: 9000 })).json()) as {
      solicitud: { id: string };
    };
    const r = await responder(a.id, s.id, 'aceptar');
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ capacidad_kg: 5000, peso_kg: 9000 });
    expect((await solicitud(s.id))?.status).toBe('pendiente');
  });

  test('si los datos cambiaron desde la propuesta, aceptar la invalida', async () => {
    const { v, a } = await viajeAsignado();
    const { solicitud: s } = (await (await proponer(v.id, { weight_kg: 1500 })).json()) as {
      solicitud: { id: string };
    };
    await handle.db
      .update(schema.trips)
      .set({ cargoWeightKg: 1200 })
      .where(eq(schema.trips.id, v.id));
    const r = await responder(a.id, s.id, 'aceptar');
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({
      code: 'solicitud_invalidada',
      motivo: 'datos_cambiaron',
    });
    expect(await solicitud(s.id)).toMatchObject({
      status: 'invalidada',
      invalidationReason: 'datos_cambiaron',
    });
  });

  test('cancelar el servicio invalida la solicitud pendiente', async () => {
    const { v } = await viajeAsignado();
    const { solicitud: s } = (await (await proponer(v.id, { weight_kg: 1500 })).json()) as {
      solicitud: { id: string };
    };
    const r = await app.request(
      `/trip-requests-v2/${v.id}/cancelar`,
      json('PATCH', { reason: 'Se suspendió el pedido' }),
    );
    expect(r.status).toBe(200);
    expect(await solicitud(s.id)).toMatchObject({
      status: 'invalidada',
      invalidationReason: 'viaje_cancelado',
    });
  });

  test('antes del match se responde trip_not_matched; sin cambios reales, 422', async () => {
    const pre = await viaje('ofertas_enviadas');
    expect((await proponer(pre.id, { weight_kg: 1500 })).status).toBe(409);
    const { v } = await viajeAsignado();
    expect((await proponer(v.id, { weight_kg: 1000 })).status).toBe(422);
  });
});
