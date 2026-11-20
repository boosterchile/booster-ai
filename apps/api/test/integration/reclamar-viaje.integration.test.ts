import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { reclamarViaje } from '../../src/services/reclamar-viaje.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * BARH-23 — reclamar carga sin oferta (spec reclamar-carga-sin-oferta).
 * Rojo primero: el service aún no existe / no cumple.
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

describe('integration: reclamar viaje sin oferta', () => {
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

  async function planId(): Promise<string> {
    const { db } = handle;
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
    const id =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  async function escenarioReclamable() {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const pid = await planId();
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-rec-${suffix}`,
          email: `rec-${suffix}@test.invalid`,
          fullName: 'Despachador',
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario',
    );
    const generador = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Gen ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `g-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: false,
          isGeneradorCarga: true,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'generador',
    );
    const transportista = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Trans ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `t-${suffix}@empresa.invalid`,
          contactPhone: '+56922222222',
          addressStreet: 'Calle 2',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'transportista',
    );
    const otra = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Otra ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `o-${suffix}@empresa.invalid`,
          contactPhone: '+56933333333',
          addressStreet: 'Calle 3',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'otra',
    );
    await db.insert(schema.zones).values([
      {
        empresaId: transportista.id,
        regionCode: 'XIII',
        zoneType: 'ambos',
        isActive: true,
      },
      {
        empresaId: otra.id,
        regionCode: 'XIII',
        zoneType: 'ambos',
        isActive: true,
      },
    ]);
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generador.id,
          createdByUserId: usuario.id,
          originAddressRaw: 'Av. Apoquindo 4500',
          destinationAddressRaw: 'Av. Libertad 100',
          originRegionCode: 'XIII',
          cargoType: 'agricola',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          proposedPriceClp: 220_000,
          status: 'ofertas_enviadas',
        })
        .returning(),
      'viaje',
    );
    // Oferta solo a `otra` — el transportista reclamante NO tiene oferta.
    // Precio de la oferta ajena distinto del canónico del viaje: el reclamo
    // debe usar el del viaje, no este ni 0.
    const ofertaOtra = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: otra.id,
          suggestedVehicleId: null,
          score: 80,
          proposedPriceClp: 150_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'ofertaOtra',
    );
    return { usuario, transportista, otra, viaje, ofertaOtra };
  }

  test('empresa sin oferta (y sin flota elegible) reclama y deja assignment sin vehículo', async () => {
    const e = await escenarioReclamable();
    const r = await reclamarViaje({
      db: handle.db,
      logger,
      tripId: e.viaje.id,
      empresaId: e.transportista.id,
      userId: e.usuario.id,
    });

    expect(r.assignment.empresaId).toBe(e.transportista.id);
    expect(r.assignment.vehicleId).toBeNull();
    expect(r.assignment.offerId).toBeTruthy();
    expect(r.assignment.agreedPriceClp).toBe(220_000);
    expect(r.assignment.agreedPriceClp).not.toBe(0);
    expect(r.assignment.agreedPriceClp).not.toBe(150_000);

    const [viaje] = await handle.db
      .select({ status: schema.trips.status })
      .from(schema.trips)
      .where(eq(schema.trips.id, e.viaje.id));
    expect(viaje?.status).toBe('asignado');

    const [ofertaOtra] = await handle.db
      .select({ status: schema.offers.status })
      .from(schema.offers)
      .where(eq(schema.offers.id, e.ofertaOtra.id));
    expect(ofertaOtra?.status).toBe('reemplazada');

    const [mia] = await handle.db
      .select({ status: schema.offers.status, empresaId: schema.offers.empresaId })
      .from(schema.offers)
      .where(
        and(eq(schema.offers.tripId, e.viaje.id), eq(schema.offers.empresaId, e.transportista.id)),
      );
    expect(mia?.status).toBe('aceptada');
  });

  test('segunda empresa no puede reclamar el mismo viaje', async () => {
    const e = await escenarioReclamable();
    await reclamarViaje({
      db: handle.db,
      logger,
      tripId: e.viaje.id,
      empresaId: e.transportista.id,
      userId: e.usuario.id,
    });
    await expect(
      reclamarViaje({
        db: handle.db,
        logger,
        tripId: e.viaje.id,
        empresaId: e.otra.id,
        userId: e.usuario.id,
      }),
    ).rejects.toMatchObject({ name: 'ViajeNoReclamableError' });
  });

  test('sin ofertas pendientes y sin precio canónico → rechaza (no agreedPrice 0)', async () => {
    const e = await escenarioReclamable();
    await handle.db
      .update(schema.trips)
      .set({ proposedPriceClp: null })
      .where(eq(schema.trips.id, e.viaje.id));
    await handle.db.delete(schema.offers).where(eq(schema.offers.tripId, e.viaje.id));

    await expect(
      reclamarViaje({
        db: handle.db,
        logger,
        tripId: e.viaje.id,
        empresaId: e.transportista.id,
        userId: e.usuario.id,
      }),
    ).rejects.toMatchObject({ name: 'PrecioReclamoInvalidoError' });
  });

  test('sin ofertas pendientes usa precio del viaje (>0), nunca 0', async () => {
    const e = await escenarioReclamable();
    await handle.db.delete(schema.offers).where(eq(schema.offers.tripId, e.viaje.id));

    const r = await reclamarViaje({
      db: handle.db,
      logger,
      tripId: e.viaje.id,
      empresaId: e.transportista.id,
      userId: e.usuario.id,
    });
    expect(r.assignment.agreedPriceClp).toBe(220_000);
    expect(r.assignment.agreedPriceClp).toBeGreaterThan(0);
  });
});
