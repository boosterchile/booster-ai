import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { resolverPosicionEnVivo } from '../../src/services/posicion-en-vivo.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Spec `.specs/tracking-live-unificado/` §2 contra Postgres real: la última
 * posición VIVA sale de Teltonika si hay ping fresco (<30 min) y, si no, del
 * móvil del conductor de ESA asignación. Ventana, filtro por asignación y
 * null island se resuelven en SQL — por eso se prueban acá y no con stub.
 */
describe('integration: resolverPosicionEnVivo (Teltonika fresco o móvil de la asignación)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const NOW = Date.parse('2026-09-20T15:00:00Z');
  const hace = (min: number) => new Date(NOW - min * 60_000);

  async function fixture() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan Live ${suffix}`,
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
    const [user] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-live-${suffix}`,
        email: `live-${suffix}@test.invalid`,
        fullName: 'Live Test',
      })
      .returning({ id: schema.users.id });
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Live SpA ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `empresa-live-${suffix}@test.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        planId,
      })
      .returning({ id: schema.empresas.id });
    if (!user || !empresa) {
      throw new Error('fixture: user/empresa no creados');
    }
    const [vehicle] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: empresa.id,
        plate: `LV${suffix.slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
      })
      .returning({ id: schema.vehicles.id });
    if (!vehicle) {
      throw new Error('fixture: vehículo no creado');
    }
    // IMEI por fixture: `uq_telemetria_imei_ts` es único por (imei, timestamp).
    const imei = `86${suffix.replace(/\D/g, '').padEnd(13, '5').slice(0, 13)}`;
    // `asignacion_id` no tiene FK: basta un uuid por asignación.
    return { userId: user.id, vehicleId: vehicle.id, imei, assignmentId: randomUUID() };
  }

  function telemetria(
    f: { vehicleId: string; imei: string },
    ts: Date,
    lat: string | null,
    lng: string | null,
  ) {
    return handle.db.insert(schema.telemetryPoints).values({
      vehicleId: f.vehicleId,
      imei: f.imei,
      timestampDevice: ts,
      priority: 0,
      latitude: lat,
      longitude: lng,
      speedKmh: 64,
      angleDeg: 90,
    });
  }

  function movil(
    f: { vehicleId: string; userId: string },
    assignmentId: string | null,
    ts: Date,
    lat: string,
    lng: string,
    speedKmh: string | null = '42.50',
  ) {
    return handle.db.insert(schema.posicionesMovilConductor).values({
      assignmentId,
      vehicleId: f.vehicleId,
      userId: f.userId,
      timestampDevice: ts,
      latitude: lat,
      longitude: lng,
      speedKmh,
      headingDeg: 180,
    });
  }

  test('solo móvil: pings frescos de ESTA asignación, DESC; excluye otra asignación, viejos y null island', async () => {
    const f = await fixture();
    await movil(f, f.assignmentId, hace(5), '-33.4500000', '-70.6500000');
    await movil(f, f.assignmentId, hace(1), '-33.4600000', '-70.6600000', null);
    await movil(f, f.assignmentId, hace(31), '-33.4000000', '-70.6000000'); // fuera de ventana
    await movil(f, f.assignmentId, hace(2), '0.0000000', '0.0000000'); // null island
    await movil(f, randomUUID(), hace(0), '-36.8000000', '-73.0500000'); // MISMO vehículo, otro viaje
    await movil(f, null, hace(0), '-36.9000000', '-73.0600000'); // sin asignación

    const r = await resolverPosicionEnVivo({
      db: handle.db,
      assignmentId: f.assignmentId,
      vehicleId: f.vehicleId,
      tripStatus: 'en_proceso',
      nowMs: NOW,
    });

    expect(r.source).toBe('mobile');
    expect(r.pings).toEqual([
      { timestamp: hace(1), latitude: -33.46, longitude: -70.66, speedKmh: null, angleDeg: 180 },
      { timestamp: hace(5), latitude: -33.45, longitude: -70.65, speedKmh: 42.5, angleDeg: 180 },
    ]);
  });

  test('Teltonika fresco gana aunque el móvil sea más reciente (sin merge de streams)', async () => {
    const f = await fixture();
    await telemetria(f, hace(10), '-33.4500000', '-70.6500000');
    await telemetria(f, hace(12), null, null); // sin fix
    await movil(f, f.assignmentId, hace(1), '-33.9000000', '-71.0000000');

    const r = await resolverPosicionEnVivo({
      db: handle.db,
      assignmentId: f.assignmentId,
      vehicleId: f.vehicleId,
      tripStatus: 'asignado',
      nowMs: NOW,
    });

    expect(r.source).toBe('teltonika');
    expect(r.pings).toEqual([
      { timestamp: hace(10), latitude: -33.45, longitude: -70.65, speedKmh: 64, angleDeg: 90 },
    ]);
  });

  test('Teltonika viejo (>30 min) o solo null island NO cuenta como fresco → cae al móvil', async () => {
    const f = await fixture();
    await telemetria(f, hace(45), '-33.4500000', '-70.6500000');
    await telemetria(f, hace(3), '0.0000000', '0.0000000');
    await movil(f, f.assignmentId, hace(2), '-33.4700000', '-70.6700000');

    const r = await resolverPosicionEnVivo({
      db: handle.db,
      assignmentId: f.assignmentId,
      vehicleId: f.vehicleId,
      tripStatus: 'en_proceso',
      nowMs: NOW,
    });

    expect(r.source).toBe('mobile');
    expect(r.pings.map((p) => p.latitude)).toEqual([-33.47]);
  });

  test('ninguna fuente fresca → source null; estado terminal → nada aunque haya pings', async () => {
    const f = await fixture();
    await telemetria(f, hace(45), '-33.4500000', '-70.6500000');
    await movil(f, f.assignmentId, hace(40), '-33.4700000', '-70.6700000');

    await expect(
      resolverPosicionEnVivo({
        db: handle.db,
        assignmentId: f.assignmentId,
        vehicleId: f.vehicleId,
        tripStatus: 'en_proceso',
        nowMs: NOW,
      }),
    ).resolves.toEqual({ source: null, pings: [] });

    await movil(f, f.assignmentId, hace(1), '-33.4800000', '-70.6800000');
    await expect(
      resolverPosicionEnVivo({
        db: handle.db,
        assignmentId: f.assignmentId,
        vehicleId: f.vehicleId,
        tripStatus: 'entregado',
        nowMs: NOW,
      }),
    ).resolves.toEqual({ source: null, pings: [] });
  });
});
