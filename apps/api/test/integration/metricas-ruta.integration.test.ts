import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * huella-consolidada parte 2 (ADR-089) contra Postgres real: la migración
 * 0080 es `expand`. Agrega `metricas_ruta` (la huella calculada una vez por
 * ruta) y, en `metricas_viaje`, la ruta de la que sale la parte del servicio,
 * su actividad, su participación y la versión del método de reparto. Ningún
 * código las escribe todavía: eso es la parte 3.
 */
describe('integration: migración 0080 — métricas de la ruta y reparto', () => {
  let handle: TestDbHandle;
  let base: { empresaId: string; usuarioId: string };

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  beforeAll(async () => {
    handle = createTestDb();
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
          fullName: 'Oficina',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
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
        .returning({ id: schema.empresas.id }),
      'empresa',
    );
    base = { empresaId: empresa.id, usuarioId: usuario.id };
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Nombre de la restricción que rechazó la escritura (drizzle la deja en `cause`). */
  async function restriccion(escritura: Promise<unknown>): Promise<string | undefined> {
    try {
      await escritura;
      return undefined;
    } catch (err) {
      const causa = (err as { cause?: { constraint?: string } }).cause;
      return causa?.constraint ?? 'error sin restricción';
    }
  }

  const crearRuta = async () =>
    uno(
      await handle.db
        .insert(schema.rutas)
        .values({ empresaId: base.empresaId })
        .returning({ id: schema.rutas.id }),
      'ruta',
    ).id;

  const crearViaje = async () =>
    uno(
      await handle.db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: base.empresaId,
          createdByUserId: base.usuarioId,
          originAddressRaw: 'A',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning({ id: schema.trips.id }),
      'viaje',
    ).id;

  test('la huella de una ruta se guarda una vez, con su desglose, método, fuente y nivel', async () => {
    const rutaId = await crearRuta();
    await handle.db.insert(schema.metricasRuta).values({
      rutaId,
      distanceKmEstimated: '410.00',
      distanceKmActual: '412.35',
      actividadTkm: '1640.000',
      carbonEmissionsKgco2eEstimated: '321.500',
      carbonEmissionsKgco2eActual: '318.417',
      emisionesKgco2eTtw: '260.512',
      emisionesKgco2eWtt: '57.905',
      intensidadGco2ePorTkm: '194.157',
      fuelConsumedLEstimated: '116.00',
      fuelConsumedLActual: '115.00',
      precisionMethod: 'exacto_canbus',
      glecVersion: 'v3.0',
      emissionFactorUsed: '2.76884',
      factoresFuente: 'SEC Chile 2024',
      routeDataSource: 'teltonika_gps',
      coveragePct: '98.02',
      certificationLevel: 'primario_verificable',
      uncertaintyFactor: '0.050',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
      calculatedAt: new Date('2026-11-11T12:00:00Z'),
    });

    const [fila] = await handle.db
      .select()
      .from(schema.metricasRuta)
      .where(eq(schema.metricasRuta.rutaId, rutaId));
    expect(fila).toMatchObject({
      rutaId,
      distanceKmActual: '412.35',
      actividadTkm: '1640.000',
      carbonEmissionsKgco2eActual: '318.417',
      emisionesKgco2eTtw: '260.512',
      emisionesKgco2eWtt: '57.905',
      precisionMethod: 'exacto_canbus',
      routeDataSource: 'teltonika_gps',
      coveragePct: '98.02',
      certificationLevel: 'primario_verificable',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
    expect(fila?.createdAt).toBeInstanceOf(Date);
  });

  test('una ruta tiene una sola fila de métricas', async () => {
    const rutaId = await crearRuta();
    await handle.db.insert(schema.metricasRuta).values({ rutaId });
    await expect(handle.db.insert(schema.metricasRuta).values({ rutaId })).rejects.toThrow();
  });

  test('las métricas son de una ruta que existe, y la ruta no se borra mientras las tenga', async () => {
    await expect(
      handle.db.insert(schema.metricasRuta).values({ rutaId: randomUUID() }),
    ).rejects.toThrow();

    const rutaId = await crearRuta();
    await handle.db.insert(schema.metricasRuta).values({ rutaId });
    await expect(
      handle.db.delete(schema.rutas).where(eq(schema.rutas.id, rutaId)),
    ).rejects.toThrow();
  });

  test('la actividad de la ruta no puede ser negativa', async () => {
    const rutaId = await crearRuta();
    expect(
      await restriccion(
        handle.db.insert(schema.metricasRuta).values({ rutaId, actividadTkm: '-1' }),
      ),
    ).toBe('ck_metricas_ruta_actividad');
  });

  test('las métricas de un viaje guardan su ruta, su actividad, su participación y la versión del reparto', async () => {
    const rutaId = await crearRuta();
    const tripId = await crearViaje();
    await handle.db.insert(schema.tripMetrics).values({
      tripId,
      rutaId,
      actividadTkm: '420.000',
      participacion: '25.61',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });

    const [fila] = await handle.db
      .select({
        rutaId: schema.tripMetrics.rutaId,
        actividadTkm: schema.tripMetrics.actividadTkm,
        participacion: schema.tripMetrics.participacion,
        versionMetodoReparto: schema.tripMetrics.versionMetodoReparto,
      })
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));
    expect(fila).toEqual({
      rutaId,
      actividadTkm: '420.000',
      participacion: '25.61',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
  });

  test('las métricas de un viaje siguen guardándose sin datos de reparto', async () => {
    const tripId = await crearViaje();
    await handle.db.insert(schema.tripMetrics).values({ tripId });

    const [fila] = await handle.db
      .select({
        rutaId: schema.tripMetrics.rutaId,
        actividadTkm: schema.tripMetrics.actividadTkm,
        participacion: schema.tripMetrics.participacion,
        versionMetodoReparto: schema.tripMetrics.versionMetodoReparto,
      })
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));
    expect(fila).toEqual({
      rutaId: null,
      actividadTkm: null,
      participacion: null,
      versionMetodoReparto: null,
    });
  });

  test.each([
    ['mayor que 100', '100.01'],
    ['negativa', '-0.01'],
  ])('la participación %s se rechaza', async (_nombre, participacion) => {
    const tripId = await crearViaje();
    expect(
      await restriccion(handle.db.insert(schema.tripMetrics).values({ tripId, participacion })),
    ).toBe('ck_metricas_viaje_participacion');
  });

  test('la cobertura de la ruta fuera de 0 a 100 se rechaza', async () => {
    const rutaId = await crearRuta();
    expect(
      await restriccion(
        handle.db.insert(schema.metricasRuta).values({ rutaId, coveragePct: '100.01' }),
      ),
    ).toBe('ck_metricas_ruta_cobertura');
  });

  test('la actividad de un viaje no puede ser negativa', async () => {
    const tripId = await crearViaje();
    expect(
      await restriccion(
        handle.db.insert(schema.tripMetrics).values({ tripId, actividadTkm: '-1' }),
      ),
    ).toBe('ck_metricas_viaje_actividad');
  });

  test('la participación acepta los extremos 0 y 100', async () => {
    for (const participacion of ['0.00', '100.00']) {
      const tripId = await crearViaje();
      await handle.db.insert(schema.tripMetrics).values({ tripId, participacion });
    }
  });

  test('las métricas de un viaje no pueden apuntar a una ruta que no existe', async () => {
    const tripId = await crearViaje();
    await expect(
      handle.db.insert(schema.tripMetrics).values({ tripId, rutaId: randomUUID() }),
    ).rejects.toThrow();
  });

  test('hay índice para buscar las métricas de los viajes de una ruta', async () => {
    const r = await handle.pool.query(
      `SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'metricas_viaje'
         AND indexname = 'idx_metricas_viaje_ruta'`,
    );
    expect(r.rowCount).toBe(1);
  });
});
