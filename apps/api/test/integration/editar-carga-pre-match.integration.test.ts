import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas PR6 contra Postgres real (§6.1, §7): editar antes del
 * match. Un cambio material con ofertas vivas las expira y devuelve la carga a
 * esperando_match; el re-matching puede volver a ofertar a la misma
 * transportista (M2). Los datos libres no tocan las ofertas.
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

describe('integration: editar una carga antes del match (PUT)', () => {
  let handle: TestDbHandle;
  let app: Hono;
  let generadora: typeof schema.empresas.$inferSelect;
  let dueno: typeof schema.users.$inferSelect;
  let transportista: typeof schema.empresas.$inferSelect;

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

  beforeAll(async () => {
    handle = createTestDb();
    const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
    generadora = await empresa('Generadora', true);
    transportista = await empresa('Transportista', false);
    dueno = await usuario('Dueña Generadora');
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

  const futuro = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  function form(extra: Record<string, unknown> = {}) {
    return {
      origin: { address_raw: 'A origen 123', region_code: 'XIII' },
      destination: { address_raw: 'B destino 456', region_code: 'V' },
      cargo: { cargo_type: 'carga_seca', weight_kg: 1000 },
      pickup_window: { start_at: futuro(24), end_at: futuro(27) },
      proposed_price_clp: null,
      modalidad_carga: 'spot',
      ...extra,
    };
  }
  const editar = (id: string, body: unknown) =>
    app.request(`/trip-requests-v2/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function cargaPublicada(status: string) {
    const v = await viaje(status);
    // Deja la carga igual al formulario base, para que lo "sin cambios" lo sea.
    const base = form();
    await handle.db
      .update(schema.trips)
      .set({
        originAddressRaw: base.origin.address_raw,
        originRegionCode: base.origin.region_code,
        destinationAddressRaw: base.destination.address_raw,
        destinationRegionCode: base.destination.region_code,
        pickupWindowStart: new Date(base.pickup_window.start_at),
        pickupWindowEnd: new Date(base.pickup_window.end_at),
      })
      .where(eq(schema.trips.id, v.id));
    return { v, base };
  }
  async function estadoOfertas(tripId: string) {
    return (
      await handle.db
        .select({ status: schema.offers.status })
        .from(schema.offers)
        .where(eq(schema.offers.tripId, tripId))
    ).map((o) => o.status);
  }

  test('cambio material con ofertas vivas: las expira, vuelve a esperando_match y se puede re-ofertar a la misma empresa', async () => {
    const { v, base } = await cargaPublicada('ofertas_enviadas');
    await oferta(v.id);
    const r = await editar(v.id, { ...base, cargo: { cargo_type: 'carga_seca', weight_kg: 2500 } });
    expect(r.status).toBe(200);
    const [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb).toMatchObject({ cargoWeightKg: 2500 });
    expect(await estadoOfertas(v.id)).toEqual(['expirada']);
    // M2: una oferta pendiente nueva a la misma transportista no viola la unicidad.
    await expect(oferta(v.id)).resolves.toBeDefined();
    const eventos = await handle.db
      .select({ tipo: schema.tripEvents.eventType, payload: schema.tripEvents.payload })
      .from(schema.tripEvents)
      .where(eq(schema.tripEvents.tripId, v.id));
    expect(eventos.find((e) => e.tipo === 'carga_editada')?.payload).toMatchObject({
      modo: 'pre_match',
      campos: ['weight_kg'],
      invalidated_offers: 1,
    });
  });

  test('el detalle cuenta las ofertas pendientes (para el aviso de la edición)', async () => {
    const { v } = await cargaPublicada('ofertas_enviadas');
    await oferta(v.id);
    const r = await app.request(`/trip-requests-v2/${v.id}`);
    expect(
      ((await r.json()) as { trip_request: { ofertas_pendientes: number } }).trip_request,
    ).toMatchObject({ ofertas_pendientes: 1 });
  });

  test('solo datos libres con ofertas vivas: las ofertas siguen pendientes', async () => {
    const { v, base } = await cargaPublicada('ofertas_enviadas');
    await oferta(v.id);
    const r = await editar(v.id, { ...base, notes: 'Andén 4' });
    expect(r.status).toBe(200);
    expect(await estadoOfertas(v.id)).toEqual(['pendiente']);
    const [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb).toMatchObject({ notes: 'Andén 4', status: 'ofertas_enviadas' });
  });

  // En borrador no corre el matching: se puede editar dos veces seguidas.
  test('el mismo origen sin coordenadas conserva las del viaje; uno nuevo las borra', async () => {
    const { v, base } = await cargaPublicada('borrador');
    await handle.db
      .update(schema.trips)
      .set({ originLatitude: '-33.4100000', originLongitude: '-70.5800000' })
      .where(eq(schema.trips.id, v.id));
    await editar(v.id, { ...base, notes: 'x' });
    let [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb?.originLatitude).toBe('-33.4100000');
    await editar(v.id, { ...base, origin: { address_raw: 'Otro origen 99', region_code: 'XIII' } });
    [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb).toMatchObject({ originAddressRaw: 'Otro origen 99', originLatitude: null });
  });

  test('borrar un dato opcional lo borra en la BD', async () => {
    const { v, base } = await cargaPublicada('borrador');
    await editar(v.id, { ...base, notes: 'Andén 4', reference: 'PO-1' });
    await editar(v.id, base);
    const [viajeDb] = await handle.db.select().from(schema.trips).where(eq(schema.trips.id, v.id));
    expect(viajeDb).toMatchObject({ notes: null, reference: null });
  });

  test('en esperando_match, después de editar corre el matching (sin candidatos: expira)', async () => {
    const { v, base } = await cargaPublicada('esperando_match');
    const r = await editar(v.id, { ...base, cargo: { cargo_type: 'carga_seca', weight_kg: 1200 } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { matching: { offers_created: number } | null };
    expect(body.matching).toMatchObject({ offers_created: 0 });
  });

  test.each([
    ['asignado', 409, 'trip_not_editable'],
    ['en_proceso', 409, 'trip_not_editable'],
    ['emparejando', 409, 'trip_busy'],
    ['cancelado', 409, 'trip_not_editable'],
  ])('%s → %i %s', async (status, http, code) => {
    const { v, base } = await cargaPublicada(status);
    const r = await editar(v.id, { ...base, notes: 'x' });
    expect(r.status).toBe(http);
    expect(await r.json()).toMatchObject({ code });
  });

  test('programada sin contrato programado → 422', async () => {
    const { v, base } = await cargaPublicada('esperando_match');
    const r = await editar(v.id, { ...base, modalidad_carga: 'programada' });
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ error: 'contrato_programado_no_habilitado' });
  });
});
