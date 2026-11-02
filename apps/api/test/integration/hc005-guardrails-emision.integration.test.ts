import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { recalcularNivelPostEntrega } from '../../src/services/calcular-metricas-viaje.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * HC-005 contra Postgres real: la decisión (guardrail83) es el ÚNICO camino a
 * `exacto_canbus`. Vehículo con config '83' (como KZXB64/LFGR63 desde 12:24):
 * si la decisión no es can_83 la emisión sale modelada; si es can_83, los
 * litros emitidos son los que validó la decisión.
 */
describe('integration: guardrails CAN gobiernan la emisión (HC-005)', () => {
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

  const ENTREGA = new Date('2026-08-10T10:30:00Z');
  const INICIO = new Date('2026-08-10T10:05:00Z');
  const N = 41; // cada 30 s, 0,005° de latitud ≈ 0,556 km → ≈ 22,2 km continuos (sin Routes)

  async function viaje(opts: {
    pickedUpAt: Date;
    io: (i: number) => Record<string, number>;
    dLat?: number;
  }) {
    const { db } = handle;
    const sfx = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `P ${sfx}`,
        description: 'x',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    const [u] = await db
      .insert(schema.users)
      .values({ firebaseUid: `fb-${sfx}`, email: `${sfx}@test.invalid`, fullName: 'C' })
      .returning({ id: schema.users.id });
    const [e] = await db
      .insert(schema.empresas)
      .values({
        legalName: `T ${sfx}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `${sfx}@e.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId: planId as string,
        carbonMeasurementEnabled: true,
      })
      .returning({ id: schema.empresas.id });
    const imei = `86${sfx.replace(/\D/g, '').padEnd(13, '7').slice(0, 13)}`;
    const [v] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: e?.id as string,
        plate: `KZ${sfx.slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
        fuelType: 'diesel',
        consumptionLPer100kmBaseline: '30.00',
        curbWeightKg: 6000,
        teltonikaImei: imei,
        fuenteCombustibleCan: '83',
      })
      .returning({ id: schema.vehicles.id });
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
        originAddressRaw: 'Origen',
        destinationAddressRaw: 'Destino',
        cargoType: 'carga_seca',
        cargoWeightKg: 3000,
        pickupDateRaw: '2026-08-10',
        pickupWindowStart: opts.pickedUpAt,
        status: 'entregado',
      })
      .returning({ id: schema.trips.id });
    const [o] = await db
      .insert(schema.offers)
      .values({
        tripId: trip?.id as string,
        empresaId: e?.id as string,
        score: 80,
        proposedPriceClp: 1,
        expiresAt: ENTREGA,
      })
      .returning({ id: schema.offers.id });
    await db.insert(schema.assignments).values({
      tripId: trip?.id as string,
      offerId: o?.id as string,
      empresaId: e?.id as string,
      vehicleId: v?.id as string,
      driverUserId: u?.id as string,
      agreedPriceClp: 1,
      status: 'entregado',
      acceptedAt: opts.pickedUpAt,
      pickedUpAt: opts.pickedUpAt,
      deliveredAt: ENTREGA,
    });
    await db.insert(schema.tripMetrics).values({
      tripId: trip?.id as string,
      distanceKmEstimated: '22.00',
      precisionMethod: 'modelado',
      routeDataSource: 'maps_directions',
      coveragePct: '0.00',
      certificationLevel: 'secundario_modeled',
    });
    await db.insert(schema.telemetryPoints).values(
      Array.from({ length: N }, (_, i) => ({
        vehicleId: v?.id as string,
        imei,
        timestampDevice: new Date(INICIO.getTime() + i * 30_000),
        priority: 0,
        latitude: (-33.4 + i * (opts.dLat ?? 0.005)).toFixed(7),
        longitude: '-70.6000000',
        ioData: opts.io(i),
      })),
    );
    const r = await recalcularNivelPostEntrega({ db, logger, tripId: trip?.id as string });
    const [m] = await db
      .select()
      .from(schema.tripMetrics)
      .where(eq(schema.tripMetrics.tripId, trip?.id as string));
    return { r, m };
  }

  const PICKUP = new Date('2026-08-10T10:00:00Z');
  // 8 L en ≈22 km (≈36 L/100 km), contador en 0,1 L.
  const limpio = (i: number) => ({ '83': 6_344_550 + Math.round((80 * i) / (N - 1)) });

  test('can_83 OK (KZXB64) → exacto_canbus con los litros de la decisión y nivel_no_evaluado', async () => {
    const { m } = await viaje({ pickedUpAt: PICKUP, io: limpio });
    expect(m).toMatchObject({
      fuenteEnergia: 'can_83',
      precisionMethod: 'exacto_canbus',
      certificationLevel: 'primario_verificable',
      alertasDecision: ['nivel_no_evaluado'],
      motivoFallback: null,
    });
    expect(Number(m?.fuelConsumedLActual)).toBe(8);
  });

  test('tope de 7 días → ventana_excede_tope y modelado (antes exacto_canbus)', async () => {
    const { m } = await viaje({
      pickedUpAt: new Date(ENTREGA.getTime() - 8 * 24 * 3600 * 1000),
      io: limpio,
    });
    expect(m).toMatchObject({
      motivoFallback: 'ventana_excede_tope',
      precisionMethod: 'modelado',
      certificationLevel: 'secundario_modeled',
    });
    expect(m?.fuelConsumedLActual).not.toBeNull(); // litros modelados, no los del 83
    expect(Number(m?.fuelConsumedLActual)).not.toBe(8);
  });

  test('alerta de rechazo: PLFL57 congelado + catch-up de 55 L (antes exacto_canbus) → can_no_monotono y modelado', async () => {
    // ≈111 km (0,025°/ping) y ≈60 L (≈54 L/100 km, dentro de banda): 36 pasos de 0,14 L,
    // 4 congelados y un catch-up de 55 L. Δ neto plausible: main lo emitía exacto_canbus.
    const io = (i: number) => ({
      '83': 6_344_550 + Math.min(i, 20) * 14 + Math.max(0, i - 24) * 14 + (i >= 24 ? 550 : 0),
    });
    const { m } = await viaje({ pickedUpAt: PICKUP, io, dLat: 0.025 });
    expect(m).toMatchObject({ motivoFallback: 'can_no_monotono', precisionMethod: 'modelado' });
  });

  test('RCPC20: una lectura en 0 en medio → can_no_monotono y modelado (antes exacto_canbus)', async () => {
    const { m } = await viaje({
      pickedUpAt: PICKUP,
      io: (i) => (i === 20 ? { '83': 0 } : limpio(i)),
    });
    expect(m).toMatchObject({ motivoFallback: 'can_no_monotono', precisionMethod: 'modelado' });
  });

  test('solo 89 → can_sin_lecturas y modelado', async () => {
    const { m } = await viaje({ pickedUpAt: PICKUP, io: (i) => ({ '89': 60 - i * 0.1 }) });
    expect(m).toMatchObject({ motivoFallback: 'can_sin_lecturas', precisionMethod: 'modelado' });
  });

  test('sin 83 (io vacío) → can_sin_lecturas y modelado', async () => {
    const { m } = await viaje({ pickedUpAt: PICKUP, io: () => ({}) });
    expect(m).toMatchObject({ motivoFallback: 'can_sin_lecturas', precisionMethod: 'modelado' });
  });
});
