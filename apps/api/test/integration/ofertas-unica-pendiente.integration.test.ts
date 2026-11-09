import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas M2 (migración 0076, contract aprobado por el PO §12-P1).
 *
 * La unicidad (viaje, empresa) de `ofertas` aplica solo a las pendientes: tras
 * una edición material las ofertas viejas quedan `expirada` y el re-matching
 * puede volver a ofertar a la misma transportista sin abortar la tx.
 */
describe('integration: unicidad de ofertas solo para pendientes (migración 0076)', () => {
  let handle: TestDbHandle;
  let tripId: string;
  let empresaId: string;

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan M2',
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
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportista ${suffix}`,
        rut: rutAleatorio(),
        contactEmail: `${suffix}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle 1',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: false,
        status: 'activa',
        planId,
      })
      .returning({ id: schema.empresas.id });
    const [trip] = await db
      .insert(schema.trips)
      .values({
        trackingCode: `M2${suffix}`,
        originAddressRaw: 'A',
        destinationAddressRaw: 'B',
        cargoType: 'carga_seca',
        cargoWeightKg: 1000,
        pickupDateRaw: '2026-11-20',
        status: 'ofertas_enviadas',
      })
      .returning({ id: schema.trips.id });
    if (!empresa || !trip) {
      throw new Error('fixture no creado');
    }
    empresaId = empresa.id;
    tripId = trip.id;
  });

  afterAll(async () => {
    await handle.pool.end();
  });

  const oferta = (status: 'pendiente' | 'expirada' | 'rechazada') =>
    handle.db.insert(schema.offers).values({
      tripId,
      empresaId,
      score: 80,
      proposedPriceClp: 100_000,
      expiresAt: new Date(Date.now() + 3_600_000),
      status,
    });

  test('la restricción vieja ya no existe y el índice parcial sí', async () => {
    const restriccion = await handle.pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'uq_ofertas_viaje_empresa'`,
    );
    expect(restriccion.rowCount).toBe(0);
    const indice = await handle.pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
       WHERE tablename = 'ofertas' AND indexname = 'uq_ofertas_viaje_empresa_pendiente'`,
    );
    expect(indice.rowCount).toBe(1);
    expect(indice.rows[0]?.indexdef).toContain('UNIQUE');
    expect(indice.rows[0]?.indexdef).toContain('(viaje_id, empresa_id)');
    expect(indice.rows[0]?.indexdef).toMatch(/WHERE \(estado = 'pendiente'/);
  });

  test('se puede volver a ofertar a la misma empresa cuando la anterior no está pendiente', async () => {
    await oferta('expirada');
    await oferta('rechazada');
    await expect(oferta('pendiente')).resolves.toBeDefined();
  });

  test('dos pendientes para el mismo viaje y empresa siguen prohibidas', async () => {
    await expect(oferta('pendiente')).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'uq_ofertas_viaje_empresa_pendiente' },
    });
  });
});
