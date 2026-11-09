import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas PR4 contra Postgres real (§8 puntos 6–8, §12-P6/P10/P11):
 *   - anular antes del match: la carga sale del listado, las ofertas expiran y
 *     el detalle muestra quién y cuándo;
 *   - cancelar después del match: motivo obligatorio, columnas de cancelación
 *     en la asignación, sigue en el listado como cancelada;
 *   - las canceladas históricas sin asignación también salen del listado;
 *   - teléfono del conductor en el detalle solo en asignado/en_proceso.
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

describe('integration: anular y cancelar cargas', () => {
  let handle: TestDbHandle;
  let app: Hono;
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

  const pedir = (path: string, init?: RequestInit) => app.request(`/trip-requests-v2${path}`, init);
  const cancelar = (id: string, body: unknown) =>
    pedir(`/${id}/cancelar`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function listado(): Promise<Array<{ id: string; status: string }>> {
    const r = await pedir('');
    return ((await r.json()) as { trip_requests: Array<{ id: string; status: string }> })
      .trip_requests;
  }
  async function detalle(id: string) {
    const r = await pedir(`/${id}`);
    expect(r.status).toBe(200);
    return (await r.json()) as {
      trip_request: {
        anulacion: { en: string; por_nombre: string | null; razon: string | null } | null;
        cancelacion: { en: string; razon: string | null } | null;
      };
      assignment: Record<string, unknown> | null;
    };
  }

  beforeAll(async () => {
    handle = createTestDb();
    const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
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
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('anular antes del match: sale del listado, expira ofertas y el detalle dice quién y cuándo', async () => {
    const v = await viaje('ofertas_enviadas');
    const o = await oferta(v.id);
    expect((await listado()).map((x) => x.id)).toContain(v.id);

    const r = await cancelar(v.id, { reason: 'Ya no la necesito' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      trip_request: { id: v.id, status: 'cancelado', tipo: 'anulacion' },
    });

    expect((await listado()).map((x) => x.id)).not.toContain(v.id);
    const [ofertaDb] = await handle.db
      .select({ status: schema.offers.status })
      .from(schema.offers)
      .where(eq(schema.offers.id, o.id));
    expect(ofertaDb?.status).toBe('expirada');

    const d = await detalle(v.id);
    expect(d.trip_request.anulacion).toMatchObject({
      por_nombre: 'Dueña Generadora',
      razon: 'Ya no la necesito',
    });
    expect(Date.parse(d.trip_request.anulacion?.en ?? '')).not.toBeNaN();
    expect(d.trip_request.cancelacion).toBeNull();
  });

  test('una cancelada histórica sin asignación también sale del listado (§12-P10)', async () => {
    const v = await viaje('cancelado');
    expect((await listado()).map((x) => x.id)).not.toContain(v.id);
    const d = await detalle(v.id);
    expect(d.trip_request.anulacion).toMatchObject({ por_nombre: null, razon: null });
  });

  test('cancelar después del match exige motivo y deja la asignación cancelada', async () => {
    const { v, a } = await viajeAsignado();
    const sinMotivo = await cancelar(v.id, {});
    expect(sinMotivo.status).toBe(422);

    const r = await cancelar(v.id, { reason: 'El cliente postergó el pedido' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      trip_request: { id: v.id, status: 'cancelado', tipo: 'cancelacion' },
    });

    const [asg] = await handle.db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, a.id));
    expect(asg).toMatchObject({
      status: 'cancelado',
      cancelledByActor: 'generador_carga',
      cancellationReason: 'El cliente postergó el pedido',
    });
    expect(asg?.cancelledAt).toBeInstanceOf(Date);

    const fila = (await listado()).find((x) => x.id === v.id);
    expect(fila?.status).toBe('cancelado');

    const d = await detalle(v.id);
    expect(d.trip_request.cancelacion).toMatchObject({ razon: 'El cliente postergó el pedido' });
    expect(d.trip_request.anulacion).toBeNull();
    expect(d.assignment).not.toHaveProperty('conductor_telefono_e164');
  });

  test('en_proceso no se cancela (409)', async () => {
    const { v } = await viajeAsignado('en_proceso');
    const r = await cancelar(v.id, { reason: 'x' });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ current_status: 'en_proceso' });
  });

  test('teléfono del conductor en el detalle solo mientras el viaje está activo (§12-P11)', async () => {
    const asignado = await viajeAsignado('asignado');
    expect((await detalle(asignado.v.id)).assignment).toMatchObject({
      conductor_telefono_e164: '+56977777777',
    });
    const enProceso = await viajeAsignado('en_proceso');
    expect((await detalle(enProceso.v.id)).assignment).toMatchObject({
      conductor_telefono_e164: '+56977777777',
    });
  });
});
