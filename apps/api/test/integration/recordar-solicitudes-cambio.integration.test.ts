import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { recordarSolicitudesCambio } from '../../src/services/recordar-solicitudes-cambio.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas §6.14 (PR9) contra Postgres real: el job recuerda las
 * solicitudes pendientes cuyo último aviso es más viejo que el intervalo, las
 * marca en la misma tx y no vuelve a tomarlas hasta el siguiente intervalo.
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
} as never as Logger;

const uno = <T>(rows: T[]): T => {
  const r = rows[0];
  if (!r) {
    throw new Error('fixture no creado');
  }
  return r;
};

describe('integration: recordatorios de solicitudes de cambio (§6.14)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function solicitud(opts: {
    creadaHaceMin: number;
    recordadaHaceMin?: number;
    estado?: string;
  }) {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `P ${s}`,
            description: 'f',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1));
    const user = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-r9-${s}`,
          email: `r9-${s}@test.invalid`,
          fullName: 'R9',
          rut: rutAleatorio(),
        })
        .returning(),
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `T ${s}`,
          rut: rutAleatorio(),
          contactEmail: `t-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'C 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId: plan.id,
        })
        .returning(),
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `R9${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
    );
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: `R9${s}`.toUpperCase(),
          originAddressRaw: 'A',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning(),
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: empresa.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
          status: 'aceptada',
        })
        .returning(),
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: empresa.id,
          vehicleId: vehiculo.id,
          agreedPriceClp: 100_000,
          status: 'asignado',
          acceptedAt: new Date(),
        })
        .returning(),
    );
    const ahora = Date.now();
    const cerrada = opts.estado && opts.estado !== 'pendiente';
    return uno(
      await db
        .insert(schema.tripChangeRequests)
        .values({
          tripId: viaje.id,
          assignmentId: asignacion.id,
          requestedByUserId: user.id,
          changes: { weight_kg: 2000 },
          previousValues: { weight_kg: 1000 },
          createdAt: new Date(ahora - opts.creadaHaceMin * 60_000),
          ...(opts.recordadaHaceMin !== undefined
            ? { lastReminderAt: new Date(ahora - opts.recordadaHaceMin * 60_000) }
            : {}),
          ...(cerrada ? { status: opts.estado as 'retirada', closedAt: new Date() } : {}),
        })
        .returning(),
    );
  }

  const leer = async (id: string) =>
    uno(
      await handle.db
        .select()
        .from(schema.tripChangeRequests)
        .where(eq(schema.tripChangeRequests.id, id)),
    );

  test('recuerda las pendientes vencidas, las marca y no repite dentro del intervalo', async () => {
    const vieja = await solicitud({ creadaHaceMin: 90 });
    const reciente = await solicitud({ creadaHaceMin: 10 });
    const recordadaHace5 = await solicitud({ creadaHaceMin: 300, recordadaHaceMin: 5 });
    const cerrada = await solicitud({ creadaHaceMin: 300, estado: 'retirada' });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));

    const r = await recordarSolicitudesCambio({ db: handle.db, logger, intervaloMin: 60, avisar });
    expect(r.recordados).toBeGreaterThanOrEqual(1);
    expect(r.fallidos).toBe(0);
    const tripsAvisados = avisar.mock.calls.map((c) => (c[1] as { tripId: string }).tripId);
    expect(tripsAvisados).toContain(vieja.tripId);
    expect(tripsAvisados).not.toContain(reciente.tripId);
    expect(tripsAvisados).not.toContain(recordadaHace5.tripId);
    expect(tripsAvisados).not.toContain(cerrada.tripId);
    expect(avisar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tripId: vieja.tripId, evento: 'cambio_recordatorio' }),
    );

    const marcada = await leer(vieja.id);
    expect(marcada.remindersSent).toBe(1);
    expect(marcada.lastReminderAt).toBeInstanceOf(Date);

    avisar.mockClear();
    await recordarSolicitudesCambio({ db: handle.db, logger, intervaloMin: 60, avisar });
    expect(avisar.mock.calls.map((c) => (c[1] as { tripId: string }).tripId)).not.toContain(
      vieja.tripId,
    );
  });

  test('un aviso que falla cuenta como fallido y no detiene el resto', async () => {
    const a = await solicitud({ creadaHaceMin: 120 });
    const b = await solicitud({ creadaHaceMin: 120 });
    const avisar = vi.fn(async (_d: unknown, o: { tripId: string }) => {
      if (o.tripId === a.tripId) {
        throw new Error('push caído');
      }
      return { destinatarios: 1, enviados: 1 };
    });
    const r = await recordarSolicitudesCambio({ db: handle.db, logger, intervaloMin: 60, avisar });
    expect(r.fallidos).toBeGreaterThanOrEqual(1);
    expect(avisar.mock.calls.map((c) => (c[1] as { tripId: string }).tripId)).toEqual(
      expect.arrayContaining([a.tripId, b.tripId]),
    );
  });
});
