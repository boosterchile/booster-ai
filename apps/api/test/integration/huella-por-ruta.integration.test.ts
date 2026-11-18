import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { calcularMetricasEstimadas } from '../../src/services/calcular-metricas-viaje.js';
import { crearRutaDeAsignacion } from '../../src/services/crear-ruta-de-asignacion.js';
import {
  calcularHuellaDeServicioSolo,
  guardarMetricasDeRuta,
} from '../../src/services/huella-por-ruta.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * huella-consolidada parte 3 (ADR-089) contra Postgres real: la huella de un
 * viaje se calcula por su ruta. Queda guardada en `metricas_ruta`, y
 * `metricas_viaje` anota de qué ruta sale su parte, con su actividad y su
 * participación. Con un solo servicio por ruta las cifras del viaje son las
 * de la ruta.
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

describe('integration: la huella del viaje sale de su ruta', () => {
  let handle: TestDbHandle;
  let base: { empresaId: string; usuarioId: string; vehiculoId: string };

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
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `HR${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_pesado',
          capacityKg: 20_000,
          curbWeightKg: 10_000,
          fuelType: 'diesel',
          consumptionLPer100kmBaseline: '32.00',
        })
        .returning({ id: schema.vehicles.id }),
      'vehículo',
    );
    base = { empresaId: empresa.id, usuarioId: usuario.id, vehiculoId: vehiculo.id };
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Un viaje asignado; con su ruta de dos paradas salvo que se pida sin ella. */
  async function viajeAsignado(opts: { conRuta: boolean }) {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: base.empresaId,
          createdByUserId: base.usuarioId,
          originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
          originRegionCode: 'XIII',
          destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
          destinationRegionCode: 'V',
          cargoType: 'carga_seca',
          cargoWeightKg: 8_000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning({ id: schema.trips.id }),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: base.empresaId,
          suggestedVehicleId: base.vehiculoId,
          score: 80,
          proposedPriceClp: 100_000,
          status: 'aceptada',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: schema.offers.id }),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: base.empresaId,
          vehicleId: base.vehiculoId,
          agreedPriceClp: 100_000,
        })
        .returning(),
      'asignación',
    );
    const rutaId = opts.conRuta
      ? (
          await db.transaction((tx) =>
            crearRutaDeAsignacion(tx, { assignment: asignacion, userId: null }),
          )
        ).rutaId
      : null;
    return { tripId: viaje.id, rutaId };
  }

  const estimar = (tripId: string) =>
    calcularMetricasEstimadas({ db: handle.db, logger, tripId, vehicleId: base.vehiculoId });

  const metricasDelViaje = async (tripId: string) =>
    uno(
      await handle.db
        .select()
        .from(schema.tripMetrics)
        .where(eq(schema.tripMetrics.tripId, tripId)),
      'métricas del viaje',
    );

  const metricasDeLaRuta = (rutaId: string) =>
    handle.db.select().from(schema.metricasRuta).where(eq(schema.metricasRuta.rutaId, rutaId));

  test('al estimar, la huella queda en la ruta y el viaje anota que es el 100 % de ella', async () => {
    const { tripId, rutaId } = await viajeAsignado({ conRuta: true });
    const r = await estimar(tripId);

    const viaje = await metricasDelViaje(tripId);
    const [ruta] = await metricasDeLaRuta(rutaId ?? '');
    expect(viaje).toMatchObject({
      rutaId,
      participacion: '100.00',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
    expect(Number(viaje.actividadTkm)).toBeCloseTo(8 * r.emisiones.distanciaKm, 3);
    // Las cifras del viaje son las de la ruta.
    expect(ruta).toMatchObject({
      distanceKmEstimated: viaje.distanceKmEstimated,
      carbonEmissionsKgco2eEstimated: viaje.carbonEmissionsKgco2eEstimated,
      emisionesKgco2eTtw: viaje.emisionesKgco2eTtw,
      emisionesKgco2eWtt: viaje.emisionesKgco2eWtt,
      intensidadGco2ePorTkm: viaje.intensidadGco2ePorTkm,
      fuelConsumedLEstimated: viaje.fuelConsumedLEstimated,
      precisionMethod: 'modelado',
      routeDataSource: 'maps_directions',
      coveragePct: '0.00',
      certificationLevel: viaje.certificationLevel,
      uncertaintyFactor: viaje.uncertaintyFactor,
      actividadTkm: viaje.actividadTkm,
      versionMetodoReparto: 'tkm-distancia-directa-v1',
      carbonEmissionsKgco2eActual: null,
    });
    expect(Number(viaje.carbonEmissionsKgco2eEstimated)).toBe(r.emisiones.emisionesKgco2eWtw);
  });

  test('estimar dos veces deja una sola fila por ruta', async () => {
    const { tripId, rutaId } = await viajeAsignado({ conRuta: true });
    await estimar(tripId);
    await estimar(tripId);

    expect(await metricasDeLaRuta(rutaId ?? '')).toHaveLength(1);
  });

  test('un viaje cuya asignación aún no tiene ruta se calcula igual y no anota ruta', async () => {
    const conRuta = await viajeAsignado({ conRuta: true });
    const sinRuta = await viajeAsignado({ conRuta: false });
    await estimar(conRuta.tripId);
    await estimar(sinRuta.tripId);

    const a = await metricasDelViaje(conRuta.tripId);
    const b = await metricasDelViaje(sinRuta.tripId);
    expect(b.carbonEmissionsKgco2eEstimated).toBe(a.carbonEmissionsKgco2eEstimated);
    expect(b.emisionesKgco2eTtw).toBe(a.emisionesKgco2eTtw);
    expect(b).toMatchObject({ rutaId: null, participacion: null, actividadTkm: null });
  });

  const NIVEL = {
    routeDataSource: 'teltonika_gps',
    coveragePct: 97.5,
    certificationLevel: 'secundario_modeled',
    uncertaintyFactor: 0.08,
  } as const;

  test('al cierre con huella medida, la ruta guarda las cifras reales y su desglose', async () => {
    const { tripId, rutaId } = await viajeAsignado({ conRuta: true });
    await estimar(tripId);
    const huella = calcularHuellaDeServicioSolo(tripId, {
      metodo: 'exacto_canbus',
      distanciaKm: 118.4,
      cargaKg: 8_000,
      combustibleConsumido: 41.3,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 32,
        pesoVacioKg: 10_000,
        capacidadKg: 20_000,
      },
    });
    await guardarMetricasDeRuta(handle.db, {
      tripId,
      momento: 'real',
      huella,
      nivel: NIVEL,
      distanciaKmReal: 118.4,
    });

    const [ruta] = await metricasDeLaRuta(rutaId ?? '');
    expect(ruta).toMatchObject({
      distanceKmActual: '118.40',
      carbonEmissionsKgco2eActual: huella.ruta.emisionesKgco2eWtw.toFixed(3),
      emisionesKgco2eTtw: huella.ruta.emisionesKgco2eTtw.toFixed(3),
      emisionesKgco2eWtt: huella.ruta.emisionesKgco2eWtt.toFixed(3),
      fuelConsumedLActual: '41.30',
      precisionMethod: 'exacto_canbus',
      routeDataSource: 'teltonika_gps',
      coveragePct: '97.50',
      actividadTkm: '947.200',
    });
    // La estimación no se pisa.
    expect(ruta?.carbonEmissionsKgco2eEstimated).not.toBeNull();
    expect((await metricasDelViaje(tripId)).actividadTkm).toBe('947.200');
  });

  test('al cierre sin huella medida, las cifras reales y el desglose de la ruta quedan vacíos', async () => {
    const { tripId, rutaId } = await viajeAsignado({ conRuta: true });
    await estimar(tripId);
    await guardarMetricasDeRuta(handle.db, {
      tripId,
      momento: 'real',
      huella: null,
      nivel: { ...NIVEL, coveragePct: 40 },
      distanciaKmReal: null,
    });

    const [ruta] = await metricasDeLaRuta(rutaId ?? '');
    expect(ruta).toMatchObject({
      distanceKmActual: null,
      carbonEmissionsKgco2eActual: null,
      emisionesKgco2eTtw: null,
      emisionesKgco2eWtt: null,
      intensidadGco2ePorTkm: null,
      coveragePct: '40.00',
    });
    expect(ruta?.carbonEmissionsKgco2eEstimated).not.toBeNull();
  });

  test('al cierre de un viaje que no mide huella, solo cambian la distancia y el nivel', async () => {
    const { tripId, rutaId } = await viajeAsignado({ conRuta: true });
    await estimar(tripId);
    const [antes] = await metricasDeLaRuta(rutaId ?? '');
    await guardarMetricasDeRuta(handle.db, {
      tripId,
      momento: 'nivel',
      huella: null,
      nivel: NIVEL,
      distanciaKmReal: 120.5,
    });

    const [despues] = await metricasDeLaRuta(rutaId ?? '');
    expect(despues).toMatchObject({
      distanceKmActual: '120.50',
      routeDataSource: 'teltonika_gps',
      coveragePct: '97.50',
      carbonEmissionsKgco2eEstimated: antes?.carbonEmissionsKgco2eEstimated,
      emisionesKgco2eTtw: antes?.emisionesKgco2eTtw,
      emisionesKgco2eWtt: antes?.emisionesKgco2eWtt,
      carbonEmissionsKgco2eActual: null,
    });
  });
});
