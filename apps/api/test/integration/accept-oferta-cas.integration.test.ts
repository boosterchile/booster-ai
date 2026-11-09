import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { OfferNotPendingError, acceptOffer } from '../../src/services/offer-actions.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas PR1 / SC4 contra Postgres real.
 *
 * `acceptOffer` validaba la oferta ANTES de tomar el lock del viaje y la
 * marcaba aceptada sin exigir que siguiera pendiente. Si otra transacción
 * cambiaba la oferta entre esa lectura y el lock (una edición que invalida
 * las ofertas, una anulación), el accept seguía y creaba la asignación con
 * una oferta que ya no era válida.
 *
 * El test lo reproduce: otra conexión toma el lock del viaje, `acceptOffer`
 * lee la oferta pendiente y queda esperando ese lock, la otra conexión expira
 * la oferta y suelta el lock. El accept tiene que responder OfferNotPending y
 * no crear asignación.
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

describe('integration: acceptOffer revalida la oferta tras el lock del viaje', () => {
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

  async function escenario() {
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
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `CA${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
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
          suggestedVehicleId: vehiculo.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    return { usuario, empresa, viaje, oferta };
  }

  test('una oferta invalidada mientras el accept esperaba el lock → OfferNotPending y sin asignación', async () => {
    const { usuario, empresa, viaje, oferta } = await escenario();
    const otra = await handle.pool.connect();
    try {
      await otra.query('BEGIN');
      await otra.query('SELECT id FROM viajes WHERE id = $1 FOR UPDATE', [viaje.id]);

      const aceptacion = acceptOffer({
        db: handle.db,
        logger,
        offerId: oferta.id,
        empresaId: empresa.id,
        userId: usuario.id,
      }).then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, err }),
      );

      // El accept ya leyó la oferta pendiente y espera el lock del viaje.
      await new Promise((r) => setTimeout(r, 300));
      await otra.query("UPDATE ofertas SET estado = 'expirada' WHERE id = $1", [oferta.id]);
      await otra.query('COMMIT');

      const resultado = await aceptacion;
      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.err).toBeInstanceOf(OfferNotPendingError);
      }
    } finally {
      otra.release();
    }

    const asignaciones = await handle.db
      .select({ id: schema.assignments.id })
      .from(schema.assignments)
      .where(eq(schema.assignments.tripId, viaje.id));
    expect(asignaciones).toHaveLength(0);
    const [ofertaFinal] = await handle.db
      .select({ status: schema.offers.status })
      .from(schema.offers)
      .where(eq(schema.offers.id, oferta.id));
    expect(ofertaFinal?.status).toBe('expirada');
  });

  test('sin interferencias, el accept sigue funcionando', async () => {
    const { usuario, empresa, viaje, oferta } = await escenario();
    const r = await acceptOffer({
      db: handle.db,
      logger,
      offerId: oferta.id,
      empresaId: empresa.id,
      userId: usuario.id,
    });
    expect(r.assignment.tripId).toBe(viaje.id);
    const [ofertaFinal] = await handle.db
      .select({ status: schema.offers.status })
      .from(schema.offers)
      .where(eq(schema.offers.id, oferta.id));
    expect(ofertaFinal?.status).toBe('aceptada');
  });
});
