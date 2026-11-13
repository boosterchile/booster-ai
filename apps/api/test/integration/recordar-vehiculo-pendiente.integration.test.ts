import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { recordarVehiculoPendiente } from '../../src/services/recordar-vehiculo-pendiente.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * matching-desde-la-carga §3.9 / §11-3 contra Postgres real: el job
 * recuerda 24 h / 2 h antes a la oficina y avisa al generador si la
 * ventana ya empezó, marcando cada etapa una sola vez.
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

describe('integration: recordatorios de vehículo pendiente (§3.9)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function asignacionSinVehiculo(opts: {
    ventanaEn: Date;
    status?: 'asignado' | 'cancelado' | 'recogido' | 'entregado';
    conVehiculo?: boolean;
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
    let vehicleId: string | null = null;
    if (opts.conVehiculo) {
      vehicleId = uno(
        await db
          .insert(schema.vehicles)
          .values({
            empresaId: empresa.id,
            plate: `VP${s.slice(0, 4).toUpperCase()}`,
            vehicleType: 'camion_mediano',
            capacityKg: 5000,
          })
          .returning(),
      ).id;
    }
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: `VP${s}`.toUpperCase(),
          originAddressRaw: 'A',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          pickupWindowStart: opts.ventanaEn,
          pickupWindowEnd: new Date(opts.ventanaEn.getTime() + 3_600_000),
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
    return uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: empresa.id,
          vehicleId,
          agreedPriceClp: 100_000,
          status: opts.status ?? 'asignado',
          acceptedAt: new Date(),
        })
        .returning(),
    );
  }

  const leer = async (id: string) =>
    uno(await handle.db.select().from(schema.assignments).where(eq(schema.assignments.id, id)));

  const ahora = new Date('2026-11-13T15:00:00.000Z');
  const h = (horas: number) => new Date(ahora.getTime() + horas * 3_600_000);

  test('24 h / 2 h / vencido: avisa el canal correcto y no repite la etapa', async () => {
    const a24 = await asignacionSinVehiculo({ ventanaEn: h(10) }); // en ventana 24h
    const a2 = await asignacionSinVehiculo({ ventanaEn: h(1) }); // en ventana 2h
    const vencida = await asignacionSinVehiculo({ ventanaEn: h(-1) });
    const lejos = await asignacionSinVehiculo({ ventanaEn: h(48) });
    const conVehiculo = await asignacionSinVehiculo({ ventanaEn: h(1), conVehiculo: true });
    const cancelada = await asignacionSinVehiculo({ ventanaEn: h(1), status: 'cancelado' });

    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    const r = await recordarVehiculoPendiente({
      db: handle.db,
      logger,
      now: ahora,
      avisar,
    });
    expect(r.fallidos).toBe(0);
    expect(r.recordadosOficina).toBeGreaterThanOrEqual(2);
    expect(r.avisadosGenerador).toBeGreaterThanOrEqual(1);

    const porTrip = new Map(
      avisar.mock.calls.map((c) => {
        const o = c[1] as { tripId: string; evento: string };
        return [o.tripId, o.evento];
      }),
    );
    expect(porTrip.get(a24.tripId)).toBe('vehiculo_pendiente_24h');
    expect(porTrip.get(a2.tripId)).toBe('vehiculo_pendiente_2h');
    expect(porTrip.get(vencida.tripId)).toBe('vehiculo_pendiente_vencido');
    expect(porTrip.has(lejos.tripId)).toBe(false);
    expect(porTrip.has(conVehiculo.tripId)).toBe(false);
    expect(porTrip.has(cancelada.tripId)).toBe(false);

    expect((await leer(a24.id)).vehicleReminder24hAt).toBeInstanceOf(Date);
    expect((await leer(a2.id)).vehicleReminder2hAt).toBeInstanceOf(Date);
    expect((await leer(vencida.id)).vehicleMissingGeneratorNotifiedAt).toBeInstanceOf(Date);

    avisar.mockClear();
    const r2 = await recordarVehiculoPendiente({
      db: handle.db,
      logger,
      now: ahora,
      avisar,
    });
    expect(avisar).not.toHaveBeenCalled();
    expect(r2).toEqual({ recordadosOficina: 0, avisadosGenerador: 0, fallidos: 0 });
  });

  test('si el push falla o enviados===0 limpia la marca y reintenta', async () => {
    const a24 = await asignacionSinVehiculo({ ventanaEn: h(10) });
    const a2 = await asignacionSinVehiculo({ ventanaEn: h(1) });

    const avisar = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('push caído');
      })
      .mockImplementationOnce(async () => ({ destinatarios: 1, enviados: 0 }))
      .mockImplementation(async () => ({ destinatarios: 1, enviados: 1 }));

    const r1 = await recordarVehiculoPendiente({
      db: handle.db,
      logger,
      now: ahora,
      avisar,
    });
    expect(r1.fallidos).toBeGreaterThanOrEqual(2);
    expect(r1.recordadosOficina).toBe(0);
    expect((await leer(a24.id)).vehicleReminder24hAt).toBeNull();
    expect((await leer(a2.id)).vehicleReminder2hAt).toBeNull();

    avisar.mockClear();
    avisar.mockImplementation(async () => ({ destinatarios: 1, enviados: 1 }));
    const r2 = await recordarVehiculoPendiente({
      db: handle.db,
      logger,
      now: ahora,
      avisar,
    });
    expect(r2.fallidos).toBe(0);
    expect(r2.recordadosOficina).toBeGreaterThanOrEqual(2);
    expect((await leer(a24.id)).vehicleReminder24hAt).toBeInstanceOf(Date);
    expect((await leer(a2.id)).vehicleReminder2hAt).toBeInstanceOf(Date);
  });
});
