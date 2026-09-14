import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { resolverPosicionesSegmento } from '../../src/services/posicion-segmento.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * Task 10 (plan medicion-huella-segmento, ADR-077 §1) contra Postgres real:
 * cada vehículo lee de UNA sola fuente según su dispositivo, dentro de la
 * ventana `[desde, hasta]`, ascendente por timestamp, sin filas sin fix.
 *
 *   - A: `teltonika_imei` propio → sus pings de `telemetria_puntos` (por
 *     vehiculo_id). Sus posiciones de móvil, si las hubiera, se IGNORAN.
 *   - B: solo `teltonika_imei_espejo` = imei de A → los pings de A (por imei),
 *     aunque B no tenga filas propias.
 *   - C: sin dispositivo → `posiciones_movil_conductor` (por vehiculo_id).
 *     Una fila de telemetría colgada de C se IGNORA (sin merge de streams).
 */
describe('integration: resolverPosicionesSegmento (enrutamiento por dispositivo)', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const DESDE = new Date('2026-08-10T10:00:00Z');
  const HASTA = new Date('2026-08-10T12:00:00Z');
  const t = (hhmm: string) => new Date(`2026-08-10T${hhmm}:00Z`);

  async function fixture() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: `Plan Segmento ${suffix}`,
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
        firebaseUid: `fb-seg-${suffix}`,
        email: `seg-${suffix}@test.invalid`,
        fullName: 'Segmento Test',
      })
      .returning({ id: schema.users.id });
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Segmento SpA ${suffix}`,
        rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
        contactEmail: `empresa-${suffix}@test.invalid`,
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
    const imei = `86${suffix.replace(/\D/g, '').padEnd(13, '7').slice(0, 13)}`;
    const mkVehicle = async (plateTag: string, dev: { imei?: string; espejo?: string }) => {
      const [v] = await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `${plateTag}${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          ...(dev.imei ? { teltonikaImei: dev.imei } : {}),
          ...(dev.espejo ? { teltonikaImeiEspejo: dev.espejo } : {}),
        })
        .returning({
          id: schema.vehicles.id,
          teltonikaImei: schema.vehicles.teltonikaImei,
          teltonikaImeiEspejo: schema.vehicles.teltonikaImeiEspejo,
        });
      if (!v) {
        throw new Error(`fixture: vehículo ${plateTag} no creado`);
      }
      return v;
    };
    const vehA = await mkVehicle('SA', { imei });
    const vehB = await mkVehicle('SB', { espejo: imei });
    const vehC = await mkVehicle('SC', {});
    return { userId: user.id, imei, vehA, vehB, vehC };
  }

  function telemetria(
    vehicleId: string,
    imei: string,
    ts: Date,
    lat: string | null,
    lng: string | null,
  ) {
    return handle.db.insert(schema.telemetryPoints).values({
      vehicleId,
      imei,
      timestampDevice: ts,
      priority: 0,
      latitude: lat,
      longitude: lng,
    });
  }

  function movil(vehicleId: string, userId: string, ts: Date, lat: string, lng: string) {
    return handle.db.insert(schema.posicionesMovilConductor).values({
      vehicleId,
      userId,
      timestampDevice: ts,
      latitude: lat,
      longitude: lng,
    });
  }

  test('A (imei propio): telemetría en ventana, ascendente, sin filas sin fix; ignora su móvil', async () => {
    const { userId, imei, vehA } = await fixture();
    await telemetria(vehA.id, imei, t('09:59'), '-33.4000000', '-70.6000000'); // fuera (antes)
    await telemetria(vehA.id, imei, t('10:30'), '-33.4600000', '-70.6600000'); // dentro (desordenado a propósito)
    await telemetria(vehA.id, imei, t('10:10'), '-33.4500000', '-70.6500000'); // dentro
    await telemetria(vehA.id, imei, t('10:20'), null, null); // sin fix
    await telemetria(vehA.id, imei, t('10:25'), '0.0000000', '0.0000000'); // null island
    await telemetria(vehA.id, imei, t('12:01'), '-33.4700000', '-70.6700000'); // fuera (después)
    await movil(vehA.id, userId, t('10:15'), '-33.9000000', '-71.0000000'); // otra fuente: se ignora

    const pings = await resolverPosicionesSegmento({
      db: handle.db,
      vehicle: vehA,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(pings).toEqual([
      { tMs: t('10:10').getTime(), lat: -33.45, lng: -70.65 },
      { tMs: t('10:30').getTime(), lat: -33.46, lng: -70.66 },
    ]);
  });

  test('B (solo espejo): lee los pings de A por imei aunque no tenga filas propias', async () => {
    const { imei, vehA, vehB } = await fixture();
    await telemetria(vehA.id, imei, t('10:10'), '-33.4500000', '-70.6500000');
    await telemetria(vehA.id, imei, t('10:30'), '-33.4600000', '-70.6600000');

    const pings = await resolverPosicionesSegmento({
      db: handle.db,
      vehicle: vehB,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(pings.map((p) => p.tMs)).toEqual([t('10:10').getTime(), t('10:30').getTime()]);
  });

  test('C (sin dispositivo): posiciones del móvil en ventana, ascendente; ignora telemetría colgada de C', async () => {
    const { userId, vehC } = await fixture();
    await movil(vehC.id, userId, t('11:30'), '-33.4600000', '-70.6600000'); // dentro (desordenado)
    await movil(vehC.id, userId, t('11:00'), '-33.4500000', '-70.6500000'); // dentro
    await movil(vehC.id, userId, t('12:30'), '-33.4700000', '-70.6700000'); // fuera
    // Sin merge de streams: aunque alguien cuelgue telemetría de C, C no tiene
    // dispositivo → esa fila NO entra al segmento.
    await telemetria(vehC.id, '869999999999999', t('11:15'), '-33.9000000', '-71.0000000');

    const pings = await resolverPosicionesSegmento({
      db: handle.db,
      vehicle: vehC,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(pings).toEqual([
      { tMs: t('11:00').getTime(), lat: -33.45, lng: -70.65 },
      { tMs: t('11:30').getTime(), lat: -33.46, lng: -70.66 },
    ]);
  });

  test('sin datos en la ventana → [] (no lanza)', async () => {
    const { vehC } = await fixture();
    await expect(
      resolverPosicionesSegmento({ db: handle.db, vehicle: vehC, desde: DESDE, hasta: HASTA }),
    ).resolves.toEqual([]);
  });
});
