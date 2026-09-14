import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { haversineKm } from '../../src/services/calcular-cobertura-telemetria.js';
import { recalcularNivelPostEntrega } from '../../src/services/calcular-metricas-viaje.js';
import { confirmarRecogidaViaje } from '../../src/services/confirmar-recogida-viaje.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Task 11 (plan medicion-huella-segmento) contra Postgres real: la distancia
 * real se mide sobre el segmento `[recogido_en, entregado_en]`, leyendo de la
 * fuente que corresponde al vehículo (Task 10) y persistiendo esa fuente.
 *
 * ⚠️ ANTI-FALSO-VERDE (plan, Task 11): el camino del vehículo SIN Teltonika
 * pasa PRIMERO por el handler real de recogida (F1, `confirmarRecogidaViaje`),
 * que es quien escribe `recogido_en`. Sin F1 no existe el ancla de la ventana
 * y `posiciones_movil_conductor` mediría el tramo camino-al-origen — un
 * "fallback estimado correcto" que en realidad sería un bug de anclaje.
 */
describe('integration: distancia real sobre el segmento recogida → entrega (T11)', () => {
  let handle: TestDbHandle;

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

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const t = (hhmmss: string) => new Date(`2026-08-10T${hhmmss}Z`);
  const VENTANA_PLANIFICADA = t('09:00:00'); // pickup_window_start (planificado)
  const RECOGIDA_REAL = t('10:00:00'); // recogido_en (F1)
  const ENTREGA = t('10:10:00');

  // Cuatro puntos ~1 km entre sí (0,0108° de longitud a −33,4° ≈ 1 km), cada
  // 30 s → tres tramos continuos (gap < 60 s), sin huecos → no se llama a Routes.
  const RUTA_EN_VENTANA: Array<[string, string, string]> = [
    ['10:00:30', '-33.4000000', '-70.6000000'],
    ['10:01:00', '-33.4000000', '-70.6108000'],
    ['10:01:30', '-33.4000000', '-70.6216000'],
    ['10:02:00', '-33.4000000', '-70.6324000'],
  ];
  const KM_EN_VENTANA =
    haversineKm(-33.4, -70.6, -33.4, -70.6108) +
    haversineKm(-33.4, -70.6108, -33.4, -70.6216) +
    haversineKm(-33.4, -70.6216, -33.4, -70.6324);

  // Tramo camino-al-origen (ANTES de la recogida): continuo entre sí, pero
  // fuera del segmento medido. Si la ventana se anclara a la planificada
  // (09:00) entraría al cálculo y el gap 09:52 → 10:00:30 pediría Routes.
  const CAMINO_AL_ORIGEN: Array<[string, string, string]> = [
    ['09:50:00', '-33.5000000', '-70.7000000'],
    ['09:50:30', '-33.5000000', '-70.7108000'],
    ['09:51:00', '-33.5000000', '-70.7216000'],
    ['09:52:00', '-33.5000000', '-70.7324000'],
  ];

  async function fixture() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan T11 ${suffix}`,
        description: 'plan de fixture para integration tests',
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
    const [conductor] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-t11-${suffix}`,
        email: `t11-${suffix}@test.invalid`,
        fullName: 'Conductor T11',
      })
      .returning({ id: schema.users.id });
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes T11 ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `t11-${suffix}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId,
      })
      .returning({ id: schema.empresas.id });
    if (!conductor || !empresa) {
      throw new Error('fixture: conductor/empresa no creados');
    }
    const imei = `86${suffix.replace(/\D/g, '').padEnd(13, '5').slice(0, 13)}`;
    const mkVehicle = async (plateTag: string, dev: { imei?: string }) => {
      const [v] = await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `${plateTag}${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          ...(dev.imei ? { teltonikaImei: dev.imei } : {}),
        })
        .returning({ id: schema.vehicles.id });
      if (!v) {
        throw new Error(`fixture: vehículo ${plateTag} no creado`);
      }
      return v.id;
    };
    return {
      suffix,
      conductorId: conductor.id,
      empresaId: empresa.id,
      imei,
      vehTeltonika: await mkVehicle('TA', { imei }),
      vehMovil: await mkVehicle('TC', {}),
    };
  }

  /** Viaje asignado a `vehicleId` + métricas estimadas previas (como deja `calcularMetricasEstimadas`). */
  async function viajeAsignado(f: Awaited<ReturnType<typeof fixture>>, vehicleId: string) {
    const { db } = handle;
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
        destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
        cargoType: 'carga_seca',
        cargoWeightKg: 3000,
        pickupDateRaw: '2026-08-10',
        pickupWindowStart: VENTANA_PLANIFICADA,
        status: 'asignado',
      })
      .returning({ id: schema.trips.id });
    if (!trip) {
      throw new Error('fixture: trip no creado');
    }
    const [offer] = await db
      .insert(schema.offers)
      .values({
        tripId: trip.id,
        empresaId: f.empresaId,
        score: 80,
        proposedPriceClp: 100_000,
        expiresAt: t('23:00:00'),
      })
      .returning({ id: schema.offers.id });
    if (!offer) {
      throw new Error('fixture: oferta no creada');
    }
    const [assignment] = await db
      .insert(schema.assignments)
      .values({
        tripId: trip.id,
        offerId: offer.id,
        empresaId: f.empresaId,
        vehicleId,
        driverUserId: f.conductorId,
        agreedPriceClp: 100_000,
        status: 'asignado',
        acceptedAt: t('09:30:00'),
      })
      .returning({ id: schema.assignments.id });
    if (!assignment) {
      throw new Error('fixture: asignación no creada');
    }
    await db.insert(schema.tripMetrics).values({
      tripId: trip.id,
      distanceKmEstimated: '120.00',
      precisionMethod: 'modelado',
      routeDataSource: 'maps_directions',
      coveragePct: '0.00',
      certificationLevel: 'secundario_modeled',
    });
    return { tripId: trip.id, assignmentId: assignment.id };
  }

  /** F1 real: el handler de recogida escribe `recogido_en` y abre la ventana. */
  async function recogidaPorElConductor(
    f: Awaited<ReturnType<typeof fixture>>,
    assignmentId: string,
  ) {
    const r = await confirmarRecogidaViaje({
      db: handle.db,
      logger,
      assignmentId,
      actor: {
        userId: f.conductorId,
        empresaId: f.empresaId,
        esConductorAsignado: true,
        esCarrierConEscritura: false,
      },
      pickedUpAt: RECOGIDA_REAL,
    });
    expect(r.ok).toBe(true);
    const [a] = await handle.db
      .select({ status: schema.assignments.status, pickedUpAt: schema.assignments.pickedUpAt })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, assignmentId));
    expect(a?.status).toBe('recogido');
    expect(a?.pickedUpAt?.toISOString()).toBe(RECOGIDA_REAL.toISOString());
  }

  async function entregaRegistrada(tripId: string, assignmentId: string) {
    // Cierre del segmento. Se escribe directo (no vía `confirmarEntregaViaje`)
    // para no disparar el post-commit completo (certificado, scoring, coaching,
    // liquidación); el sujeto de este test es el recálculo, no ese fan-out.
    await handle.db
      .update(schema.assignments)
      .set({ status: 'entregado', deliveredAt: ENTREGA })
      .where(eq(schema.assignments.id, assignmentId));
    await handle.db
      .update(schema.trips)
      .set({ status: 'entregado' })
      .where(eq(schema.trips.id, tripId));
  }

  function movil(
    vehicleId: string,
    userId: string,
    puntos: ReadonlyArray<[string, string, string]>,
  ) {
    return handle.db.insert(schema.posicionesMovilConductor).values(
      puntos.map(([hhmmss, lat, lng]) => ({
        vehicleId,
        userId,
        timestampDevice: t(hhmmss),
        latitude: lat,
        longitude: lng,
      })),
    );
  }

  function telemetria(
    vehicleId: string,
    imei: string,
    puntos: ReadonlyArray<[string, string, string]>,
  ) {
    return handle.db.insert(schema.telemetryPoints).values(
      puntos.map(([hhmmss, lat, lng]) => ({
        vehicleId,
        imei,
        timestampDevice: t(hhmmss),
        priority: 0,
        latitude: lat,
        longitude: lng,
      })),
    );
  }

  async function metricas(tripId: string) {
    const [m] = await handle.db
      .select({
        distanceKmActual: schema.tripMetrics.distanceKmActual,
        routeDataSource: schema.tripMetrics.routeDataSource,
        coveragePct: schema.tripMetrics.coveragePct,
        certificationLevel: schema.tripMetrics.certificationLevel,
      })
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, tripId));
    return m;
  }

  test('vehículo SIN Teltonika: tras F1, mide sobre posiciones_movil_conductor y persiste movil_gps (nunca primario)', async () => {
    const f = await fixture();
    const { tripId, assignmentId } = await viajeAsignado(f, f.vehMovil);
    await recogidaPorElConductor(f, assignmentId);
    // Camino al origen (antes de la recogida) + recorrido dentro del segmento.
    await movil(f.vehMovil, f.conductorId, [...CAMINO_AL_ORIGEN, ...RUTA_EN_VENTANA]);
    await entregaRegistrada(tripId, assignmentId);

    const r = await recalcularNivelPostEntrega({ db: handle.db, logger, tripId });

    expect(r.recomputed).toBe(true);
    expect(r.routeDataSource).toBe('movil_gps');
    expect(r.pickupAtSource).toBe('recogido_en');
    // Solo los tres tramos dentro de [recogido_en, entregado_en]; el camino al
    // origen queda fuera de la ventana y no pide Routes.
    expect(r.kmCubiertos).toBeCloseTo(KM_EN_VENTANA, 3);
    expect(r.distanciaKmReal).toBeCloseTo(KM_EN_VENTANA, 3);
    expect(r.coveragePct).toBe(100);
    expect(r.certificationLevel).toBe('secundario_modeled');

    const m = await metricas(tripId);
    expect(m?.routeDataSource).toBe('movil_gps');
    expect(Number(m?.distanceKmActual)).toBeCloseTo(KM_EN_VENTANA, 2);
    expect(Number(m?.coveragePct)).toBe(100);
    expect(m?.certificationLevel).toBe('secundario_modeled');
  });

  test('vehículo CON Teltonika: mide sobre telemetria_puntos en la misma ventana y persiste teltonika_gps', async () => {
    const f = await fixture();
    const { tripId, assignmentId } = await viajeAsignado(f, f.vehTeltonika);
    await recogidaPorElConductor(f, assignmentId);
    await telemetria(f.vehTeltonika, f.imei, [...CAMINO_AL_ORIGEN, ...RUTA_EN_VENTANA]);
    await entregaRegistrada(tripId, assignmentId);

    const r = await recalcularNivelPostEntrega({ db: handle.db, logger, tripId });

    expect(r.recomputed).toBe(true);
    expect(r.routeDataSource).toBe('teltonika_gps');
    expect(r.kmCubiertos).toBeCloseTo(KM_EN_VENTANA, 3);
    const m = await metricas(tripId);
    expect(m?.routeDataSource).toBe('teltonika_gps');
    expect(Number(m?.distanceKmActual)).toBeCloseTo(KM_EN_VENTANA, 2);
  });

  test('anclaje: posiciones solo ANTES de recogido_en no cuentan → sin_observacion (no se inventa distancia)', async () => {
    const f = await fixture();
    const { tripId, assignmentId } = await viajeAsignado(f, f.vehMovil);
    await recogidaPorElConductor(f, assignmentId);
    await movil(f.vehMovil, f.conductorId, CAMINO_AL_ORIGEN);
    await entregaRegistrada(tripId, assignmentId);

    const r = await recalcularNivelPostEntrega({ db: handle.db, logger, tripId });

    // Con la ventana anclada a la planificada (09:00) este tramo se habría
    // medido como si fuera el segmento: ese es el falso verde que T11 cierra.
    expect(r.recomputed).toBe(false);
    expect(r.abortReason).toBe('sin_observacion');
    const m = await metricas(tripId);
    expect(m?.distanceKmActual).toBeNull();
    expect(m?.routeDataSource).toBe('maps_directions');
  });
});
