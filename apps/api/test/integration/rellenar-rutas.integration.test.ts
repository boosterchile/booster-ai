import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { destinoDe, formatoDestino } from '../../src/jobs/hc001-fuente-combustible-can.js';
import { main } from '../../src/jobs/rellenar-rutas.js';
import { crearRutaDeAsignacion } from '../../src/services/crear-ruta-de-asignacion.js';
import { rellenarRutas } from '../../src/services/rellenar-rutas.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 3 (ADR-088) contra Postgres real.
 *
 * El relleno crea una ruta de dos paradas por cada asignación que no la
 * tiene, con el estado que le corresponde, y concilia las rutas que la parte 2
 * creó y cuya asignación avanzó después. Es idempotente y tiene corrida en
 * seco.
 */
const ACEPTADO = new Date('2026-10-01T10:00:00Z');
const RECOGIDO = new Date('2026-10-02T12:00:00Z');
const ENTREGADO = new Date('2026-10-02T18:00:00Z');
const CANCELADO = new Date('2026-10-02T09:00:00Z');

describe('integration: relleno de rutas de las asignaciones existentes', () => {
  let handle: TestDbHandle;
  let base: Awaited<ReturnType<typeof crearBase>>;

  beforeAll(async () => {
    handle = createTestDb();
    base = await crearBase();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  async function crearBase() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
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
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `u-${suffix}@test.invalid`,
          fullName: 'Conductor',
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `e-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning(),
      'empresa',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `RL${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    return { usuario, empresa, vehiculo };
  }

  /** Una asignación como las anteriores a la parte 2: sin ruta. */
  async function asignacionSinRuta(cambios: Partial<schema.NewAssignmentRow> = {}) {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: base.empresa.id,
          createdByUserId: base.usuario.id,
          originAddressRaw: 'Av. Apoquindo 4500',
          destinationAddressRaw: 'Av. Libertad 100',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: base.empresa.id,
          suggestedVehicleId: base.vehiculo.id,
          score: 80,
          proposedPriceClp: 100_000,
          status: 'aceptada',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: base.empresa.id,
          vehicleId: base.vehiculo.id,
          agreedPriceClp: 100_000,
          acceptedAt: ACEPTADO,
          ...cambios,
        })
        .returning(),
      'asignación',
    );
    return { viaje, asignacion };
  }

  /** Una asignación como las que crea la parte 2: con su ruta planificada. */
  async function asignacionConRuta() {
    const { viaje, asignacion } = await asignacionSinRuta();
    const { rutaId } = await handle.db.transaction((tx) =>
      crearRutaDeAsignacion(tx, { assignment: asignacion, userId: base.usuario.id }),
    );
    return { viaje, asignacion, rutaId };
  }

  async function leer(asignacionId: string) {
    const { db } = handle;
    const [asignacion] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, asignacionId));
    if (!asignacion?.rutaId) {
      return { asignacion, ruta: null, paradas: [], eventos: [] };
    }
    const [ruta] = await db
      .select()
      .from(schema.rutas)
      .where(eq(schema.rutas.id, asignacion.rutaId));
    const paradas = await db
      .select({
        orden: schema.paradasRuta.orden,
        tipo: schema.paradasRuta.tipo,
        tripId: schema.paradasRuta.tripId,
        resolvedAt: schema.paradasRuta.resolvedAt,
      })
      .from(schema.paradasRuta)
      .where(eq(schema.paradasRuta.rutaId, asignacion.rutaId))
      .orderBy(asc(schema.paradasRuta.orden));
    const eventos = await db
      .select({ tipo: schema.eventosRuta.tipo, payload: schema.eventosRuta.payload })
      .from(schema.eventosRuta)
      .where(eq(schema.eventosRuta.rutaId, asignacion.rutaId))
      .orderBy(asc(schema.eventosRuta.createdAt), asc(schema.eventosRuta.tipo));
    return { asignacion, ruta: ruta ?? null, paradas, eventos };
  }

  test('una asignación sin recoger queda con una ruta planificada igual a ella', async () => {
    const { viaje, asignacion } = await asignacionSinRuta();
    const r = await rellenarRutas(handle.db, { dryRun: false });

    const { ruta, paradas, eventos } = await leer(asignacion.id);
    expect(r.creadas).toContainEqual({
      asignacionId: asignacion.id,
      rutaId: ruta?.id,
      estado: 'planificada',
    });
    expect(ruta).toMatchObject({
      empresaId: base.empresa.id,
      vehicleId: base.vehiculo.id,
      unidadArrastreId: null,
      driverUserId: null,
      status: 'planificada',
      startedAt: null,
      closedAt: null,
      cancelledAt: null,
      createdAt: ACEPTADO,
    });
    expect(paradas).toEqual([
      { orden: 0, tipo: 'recogida', tripId: viaje.id, resolvedAt: null },
      { orden: 1, tipo: 'entrega', tripId: viaje.id, resolvedAt: null },
    ]);
    expect(eventos).toEqual([
      {
        tipo: 'ruta_creada',
        payload: { viaje_id: viaje.id, asignacion_id: asignacion.id, origen: 'relleno' },
      },
    ]);
  });

  test('una asignación entregada queda con la ruta cerrada y sus dos paradas resueltas', async () => {
    const { asignacion } = await asignacionSinRuta({
      status: 'entregado',
      driverUserId: base.usuario.id,
      pickedUpAt: RECOGIDO,
      deliveredAt: ENTREGADO,
    });
    await rellenarRutas(handle.db, { dryRun: false });

    const { ruta, paradas } = await leer(asignacion.id);
    expect(ruta).toMatchObject({
      status: 'cerrada',
      driverUserId: base.usuario.id,
      startedAt: RECOGIDO,
      closedAt: ENTREGADO,
      cancelledAt: null,
    });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([RECOGIDO, ENTREGADO]);
  });

  test('una asignación recogida queda con la ruta en curso', async () => {
    const { asignacion } = await asignacionSinRuta({
      status: 'recogido',
      driverUserId: base.usuario.id,
      pickedUpAt: RECOGIDO,
    });
    await rellenarRutas(handle.db, { dryRun: false });

    const { ruta, paradas } = await leer(asignacion.id);
    expect(ruta).toMatchObject({ status: 'en_curso', startedAt: RECOGIDO, closedAt: null });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([RECOGIDO, null]);
  });

  test('una asignación cancelada antes de recoger queda con la ruta cancelada', async () => {
    const { asignacion } = await asignacionSinRuta({
      status: 'cancelado',
      cancelledAt: CANCELADO,
    });
    await rellenarRutas(handle.db, { dryRun: false });

    const { ruta, paradas } = await leer(asignacion.id);
    expect(ruta).toMatchObject({ status: 'cancelada', cancelledAt: CANCELADO, startedAt: null });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([null, null]);
  });

  test('una asignación con datos que no cuadran se omite con su motivo', async () => {
    const { asignacion } = await asignacionSinRuta({ status: 'recogido' });
    const r = await rellenarRutas(handle.db, { dryRun: false });

    const omitida = r.omitidas.find((o) => o.asignacionId === asignacion.id);
    expect(omitida?.motivo).toMatch(/recogida/);
    expect((await leer(asignacion.id)).asignacion?.rutaId).toBeNull();
  });

  test('en seco informa lo que haría y no escribe nada', async () => {
    const { asignacion } = await asignacionSinRuta();
    const r = await rellenarRutas(handle.db, { dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.creadas.some((c) => c.asignacionId === asignacion.id)).toBe(true);
    expect((await leer(asignacion.id)).asignacion?.rutaId).toBeNull();
  });

  test('correrlo dos veces no crea rutas de más', async () => {
    const { asignacion } = await asignacionSinRuta();
    await rellenarRutas(handle.db, { dryRun: false });
    const primera = (await leer(asignacion.id)).asignacion?.rutaId;
    const segunda = await rellenarRutas(handle.db, { dryRun: false });

    expect(segunda.creadas.some((c) => c.asignacionId === asignacion.id)).toBe(false);
    expect(segunda.conciliadas.some((c) => c.asignacionId === asignacion.id)).toBe(false);
    const { asignacion: despues, eventos } = await leer(asignacion.id);
    expect(despues?.rutaId).toBe(primera);
    expect(eventos).toHaveLength(1);
  });

  test('concilia la ruta de la parte 2 cuya asignación avanzó después', async () => {
    const { asignacion, rutaId } = await asignacionConRuta();
    await handle.db
      .update(schema.assignments)
      .set({
        status: 'entregado',
        driverUserId: base.usuario.id,
        pickedUpAt: RECOGIDO,
        deliveredAt: ENTREGADO,
      })
      .where(eq(schema.assignments.id, asignacion.id));
    const r = await rellenarRutas(handle.db, { dryRun: false });

    expect(r.conciliadas).toContainEqual({
      asignacionId: asignacion.id,
      rutaId,
      desde: 'planificada',
      hacia: 'cerrada',
    });
    const { ruta, paradas, eventos } = await leer(asignacion.id);
    expect(ruta).toMatchObject({
      id: rutaId,
      status: 'cerrada',
      driverUserId: base.usuario.id,
      startedAt: RECOGIDO,
      closedAt: ENTREGADO,
    });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([RECOGIDO, ENTREGADO]);
    expect(eventos.map((e) => e.tipo).sort()).toEqual([
      'configuracion_declarada',
      'estado_cambiado',
      'ruta_creada',
    ]);
  });

  test('una ruta de la parte 2 que ya está al día no se toca', async () => {
    const { asignacion } = await asignacionConRuta();
    const r = await rellenarRutas(handle.db, { dryRun: false });

    expect(r.creadas.some((c) => c.asignacionId === asignacion.id)).toBe(false);
    expect(r.conciliadas.some((c) => c.asignacionId === asignacion.id)).toBe(false);
    expect((await leer(asignacion.id)).eventos).toHaveLength(1);
  });

  test('no toca una ruta que ya lleva paradas de otro servicio', async () => {
    const { asignacion, rutaId } = await asignacionConRuta();
    const otra = await asignacionSinRuta();
    await handle.db.insert(schema.paradasRuta).values([
      { rutaId, orden: 2, tipo: 'recogida', tripId: otra.viaje.id },
      { rutaId, orden: 3, tipo: 'entrega', tripId: otra.viaje.id },
    ]);
    await handle.db
      .update(schema.assignments)
      .set({
        status: 'entregado',
        driverUserId: base.usuario.id,
        pickedUpAt: RECOGIDO,
        deliveredAt: ENTREGADO,
      })
      .where(eq(schema.assignments.id, asignacion.id));
    const r = await rellenarRutas(handle.db, { dryRun: false });

    expect(r.omitidas.find((o) => o.asignacionId === asignacion.id)?.motivo).toMatch(
      /otros servicios/,
    );
    expect((await leer(asignacion.id)).ruta).toMatchObject({ status: 'planificada' });
  });

  test('no retrocede una ruta que va más adelante que su asignación', async () => {
    const { asignacion, rutaId } = await asignacionConRuta();
    await handle.db
      .update(schema.rutas)
      .set({ status: 'cerrada', startedAt: RECOGIDO, closedAt: ENTREGADO })
      .where(eq(schema.rutas.id, rutaId));
    const r = await rellenarRutas(handle.db, { dryRun: false });

    expect(r.omitidas.find((o) => o.asignacionId === asignacion.id)?.motivo).toMatch(/cerrada/);
    expect((await leer(asignacion.id)).ruta).toMatchObject({ status: 'cerrada' });
  });

  test('el job corre en seco si no se le pide escribir', async () => {
    const { asignacion } = await asignacionSinRuta();
    const r = await main({ DATABASE_URL: handle.url });

    expect(r.dryRun).toBe(true);
    expect(r.creadas.some((c) => c.asignacionId === asignacion.id)).toBe(true);
    expect((await leer(asignacion.id)).asignacion?.rutaId).toBeNull();
  });

  test('el job no escribe sin la confirmación del destino', async () => {
    const { asignacion } = await asignacionSinRuta();

    await expect(main({ DATABASE_URL: handle.url, DRY_RUN: 'false' })).rejects.toThrow(
      /CONFIRMAR_DESTINO/,
    );
    await expect(
      main({ DATABASE_URL: handle.url, DRY_RUN: 'false', CONFIRMAR_DESTINO: 'otro:5432/test' }),
    ).rejects.toThrow(/CONFIRMAR_DESTINO/);
    expect((await leer(asignacion.id)).asignacion?.rutaId).toBeNull();
  });

  test('el job escribe con el destino confirmado', async () => {
    const { asignacion } = await asignacionSinRuta();
    const r = await main({
      DATABASE_URL: handle.url,
      DRY_RUN: 'false',
      CONFIRMAR_DESTINO: formatoDestino(destinoDe(handle.url)),
    });

    expect(r.dryRun).toBe(false);
    expect((await leer(asignacion.id)).ruta).toMatchObject({ status: 'planificada' });
  });

  test('el job exige la conexión', async () => {
    await expect(main({})).rejects.toThrow();
  });
});
