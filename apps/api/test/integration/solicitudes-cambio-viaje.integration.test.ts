import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas M3 (migración 0076) contra Postgres real: una sola
 * solicitud pendiente por viaje, y las restricciones de cierre y respuesta.
 */
describe('integration: solicitudes de cambio de viaje (migración 0076)', () => {
  let handle: TestDbHandle;
  let base: { tripId: string; assignmentId: string; userId: string };

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan M3',
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
    const [user] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-${suffix}`,
        email: `${suffix}@test.invalid`,
        fullName: 'Gen',
        rut: rutAleatorio(),
      })
      .returning({ id: schema.users.id });
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `T ${suffix}`,
        rut: rutAleatorio(),
        contactEmail: `${suffix}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: true,
        status: 'activa',
        planId,
      })
      .returning({ id: schema.empresas.id });
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: `M3${suffix}`,
        originAddressRaw: 'A',
        destinationAddressRaw: 'B',
        cargoType: 'carga_seca',
        cargoWeightKg: 1000,
        pickupDateRaw: '2026-11-20',
        status: 'asignado',
      })
      .returning({ id: schema.trips.id });
    if (!user || !empresa || !trip) {
      throw new Error('fixture no creado');
    }
    const [oferta] = await db
      .insert(schema.offers)
      .values({
        tripId: trip.id,
        empresaId: empresa.id,
        score: 80,
        proposedPriceClp: 100_000,
        expiresAt: new Date(Date.now() + 3_600_000),
        status: 'aceptada',
      })
      .returning({ id: schema.offers.id });
    const [vehiculo] = await db
      .insert(schema.vehicles)
      .values({
        empresaId: empresa.id,
        plate: `M3${suffix.slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
      })
      .returning({ id: schema.vehicles.id });
    const [asg] = await db
      .insert(schema.assignments)
      .values({
        tripId: trip.id,
        offerId: oferta?.id ?? '',
        empresaId: empresa.id,
        vehicleId: vehiculo?.id ?? '',
        agreedPriceClp: 100_000,
        status: 'asignado',
        acceptedAt: new Date(),
      })
      .returning({ id: schema.assignments.id });
    if (!asg) {
      throw new Error('fixture: asignación');
    }
    base = { tripId: trip.id, assignmentId: asg.id, userId: user.id };
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const solicitud = (extra: Partial<typeof schema.tripChangeRequests.$inferInsert> = {}) =>
    handle.db.insert(schema.tripChangeRequests).values({
      tripId: base.tripId,
      assignmentId: base.assignmentId,
      requestedByUserId: base.userId,
      changes: { weight_kg: 2000 },
      previousValues: { weight_kg: 1000 },
      ...extra,
    });

  test('una sola pendiente por viaje', async () => {
    await solicitud();
    await expect(solicitud()).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'uq_solicitud_cambio_pendiente' },
    });
    await handle.db.execute(sql`
      UPDATE solicitudes_cambio_viaje SET estado = 'retirada', cerrado_en = now()
      WHERE viaje_id = ${base.tripId} AND estado = 'pendiente'`);
    await expect(solicitud()).resolves.toBeDefined();
  });

  test('cerrada ⇔ no pendiente', async () => {
    await expect(solicitud({ status: 'retirada' })).rejects.toMatchObject({
      cause: { constraint: 'ck_solicitud_cambio_cerrada' },
    });
  });

  test('aceptada o rechazada exigen quién y cuándo respondió', async () => {
    await expect(solicitud({ status: 'rechazada', closedAt: new Date() })).rejects.toMatchObject({
      cause: { constraint: 'ck_solicitud_cambio_respondida' },
    });
  });

  test('motivo de invalidación acotado', async () => {
    await expect(
      solicitud({ status: 'invalidada', closedAt: new Date(), invalidationReason: 'otro' }),
    ).rejects.toMatchObject({ cause: { constraint: 'ck_solicitud_cambio_motivo_invalidacion' } });
  });
});
