import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { acceptOffer } from '../../src/services/offer-actions.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * matching-desde-la-carga parte 4 (ADR-090) contra Postgres real.
 *
 * Aceptar una oferta sin vehículo sugerido deja la asignación y su ruta
 * sin vehículo (spec §3.7, criterio 3).
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

describe('integration: aceptar oferta sin vehículo sugerido', () => {
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

  async function escenarioSinVehiculoSugerido() {
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
          suggestedVehicleId: null,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    return { usuario, empresa, viaje, oferta };
  }

  test('la asignación y su ruta quedan sin vehículo', async () => {
    const e = await escenarioSinVehiculoSugerido();
    const r = await acceptOffer({
      db: handle.db,
      logger,
      offerId: e.oferta.id,
      empresaId: e.empresa.id,
      userId: e.usuario.id,
    });

    expect(r.assignment.vehicleId).toBeNull();

    const [asignacion] = await handle.db
      .select({
        vehicleId: schema.assignments.vehicleId,
        rutaId: schema.assignments.rutaId,
      })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, r.assignment.id));
    expect(asignacion).toMatchObject({ vehicleId: null });
    expect(asignacion?.rutaId).toBeTruthy();

    const [ruta] = await handle.db
      .select({
        vehicleId: schema.rutas.vehicleId,
        driverUserId: schema.rutas.driverUserId,
        status: schema.rutas.status,
      })
      .from(schema.rutas)
      .where(eq(schema.rutas.id, asignacion?.rutaId ?? ''));
    expect(ruta).toMatchObject({
      vehicleId: null,
      driverUserId: null,
      status: 'planificada',
    });
  });
});
