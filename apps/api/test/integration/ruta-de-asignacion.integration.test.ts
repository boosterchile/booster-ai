import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { acceptOffer } from '../../src/services/offer-actions.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 2 (ADR-088) contra Postgres real.
 *
 * Aceptar una oferta crea, en la misma transacción, una ruta `planificada`
 * de dos paradas y deja la asignación apuntando a ella. La migración 0078 es
 * `expand`: tablas nuevas y `asignaciones.ruta_id` opcional.
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

describe('integration: aceptar una oferta crea su ruta de dos paradas', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
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

  async function escenario() {
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
          fullName: 'Dueño',
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
          plate: `CA${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: usuario.id,
          originAddressRaw: 'Av. Apoquindo 4500',
          destinationAddressRaw: 'Av. Libertad 100',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'ofertas_enviadas',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: empresa.id,
          suggestedVehicleId: vehiculo.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    return { usuario, empresa, vehiculo, viaje, oferta };
  }

  async function aceptar() {
    const e = await escenario();
    const r = await acceptOffer({
      db: handle.db,
      logger,
      offerId: e.oferta.id,
      empresaId: e.empresa.id,
      userId: e.usuario.id,
    });
    return { ...e, assignment: r.assignment };
  }

  test('la asignación queda con una ruta planificada de su empresa y su vehículo', async () => {
    const { assignment, empresa, vehiculo } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    expect(asignacion?.rutaId).toBeTruthy();

    const [ruta] = await handle.db
      .select()
      .from(schema.rutas)
      .where(eq(schema.rutas.id, asignacion?.rutaId ?? ''));
    expect(ruta).toMatchObject({
      empresaId: empresa.id,
      vehicleId: vehiculo.id,
      unidadArrastreId: null,
      driverUserId: null,
      status: 'planificada',
      startedAt: null,
      closedAt: null,
      cancelledAt: null,
    });
  });

  test('la ruta tiene la recogida y después la entrega del servicio, sin resolver', async () => {
    const { assignment, viaje } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    const paradas = await handle.db
      .select({
        orden: schema.paradasRuta.orden,
        tipo: schema.paradasRuta.tipo,
        tripId: schema.paradasRuta.tripId,
        resolvedAt: schema.paradasRuta.resolvedAt,
      })
      .from(schema.paradasRuta)
      .where(eq(schema.paradasRuta.rutaId, asignacion?.rutaId ?? ''))
      .orderBy(asc(schema.paradasRuta.orden));
    expect(paradas).toEqual([
      { orden: 0, tipo: 'recogida', tripId: viaje.id, resolvedAt: null },
      { orden: 1, tipo: 'entrega', tripId: viaje.id, resolvedAt: null },
    ]);
  });

  test('queda el evento de creación con quién aceptó', async () => {
    const { assignment, usuario, viaje } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    const eventos = await handle.db
      .select({
        tipo: schema.eventosRuta.tipo,
        payload: schema.eventosRuta.payload,
        recordedByUserId: schema.eventosRuta.recordedByUserId,
      })
      .from(schema.eventosRuta)
      .where(eq(schema.eventosRuta.rutaId, asignacion?.rutaId ?? ''));
    expect(eventos).toEqual([
      {
        tipo: 'ruta_creada',
        payload: { viaje_id: viaje.id, asignacion_id: assignment.id },
        recordedByUserId: usuario.id,
      },
    ]);
  });

  test('un servicio no puede tener dos recogidas en la misma ruta', async () => {
    const { assignment, viaje } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    await expect(
      handle.db.insert(schema.paradasRuta).values({
        rutaId: asignacion?.rutaId ?? '',
        orden: 2,
        tipo: 'recogida',
        tripId: viaje.id,
      }),
    ).rejects.toThrow();
  });

  test('dos paradas de una ruta no comparten orden', async () => {
    const { assignment, viaje } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    const cliente = await handle.pool.connect();
    try {
      // La unicidad del orden es diferida: se comprueba al cerrar la
      // transacción, para poder reordenar dentro de una.
      await cliente.query('BEGIN');
      await cliente.query(
        "UPDATE paradas_ruta SET orden = 0 WHERE ruta_id = $1 AND viaje_id = $2 AND tipo = 'entrega'",
        [asignacion?.rutaId, viaje.id],
      );
      await expect(cliente.query('COMMIT')).rejects.toThrow(/uq_paradas_ruta_orden/);
    } finally {
      cliente.release();
    }
  });

  test('intercambiar el orden de dos paradas dentro de una transacción se acepta', async () => {
    const { assignment } = await aceptar();
    const [asignacion] = await handle.db
      .select({ rutaId: schema.assignments.rutaId })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignment.id));
    const cliente = await handle.pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query('UPDATE paradas_ruta SET orden = 1 - orden WHERE ruta_id = $1', [
        asignacion?.rutaId,
      ]);
      await cliente.query('ROLLBACK');
    } finally {
      cliente.release();
    }
  });

  test('asignaciones.ruta_id es opcional y las tablas nuevas existen', async () => {
    const columnas = await handle.pool.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'asignaciones' AND column_name = 'ruta_id'",
    );
    expect(columnas.rows).toEqual([{ is_nullable: 'YES' }]);
    const tablas = await handle.pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('rutas', 'paradas_ruta', 'eventos_ruta') ORDER BY 1",
    );
    expect(tablas.rows.map((r) => r.table_name)).toEqual(['eventos_ruta', 'paradas_ruta', 'rutas']);
  });
});
