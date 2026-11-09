import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { runMatching } from '../../src/services/matching.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * editar-anular-cargas §6.1 contra Postgres real: el matching lee el viaje con
 * FOR UPDATE en la misma tx del CAS esperando_match→emparejando. Una edición
 * que tiene la fila tomada hace esperar al matching, que después lee los datos
 * nuevos. Sin el lock, el SELECT veía la versión commiteada anterior (MVCC), el
 * CAS esperaba, pasaba igual (el estado seguía en esperando_match) y el
 * matching ofertaba con el peso/precio/región viejos.
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

describe('integration: el matching lee el viaje con lock de fila', () => {
  let handle: TestDbHandle;
  let generadoraId: string;
  let duenoId: string;

  function uno<T>(rows: T[]): T {
    const r = rows[0];
    if (!r) {
      throw new Error('fixture no creado');
    }
    return r;
  }

  beforeAll(async () => {
    handle = createTestDb();
    const [plan] = await handle.db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan matching lock',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ??
      (await handle.db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const suffix = randomUUID().slice(0, 8);
    generadoraId = uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: `Generadora lock ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `gen-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: false,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id }),
    ).id;
    duenoId = uno(
      await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `${suffix}@test.invalid`,
          fullName: 'Dueña lock',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
    ).id;
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('una edición con la fila tomada hace esperar al matching, que usa los datos nuevos', async () => {
    const viaje = uno(
      await handle.db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generadoraId,
          createdByUserId: duenoId,
          originAddressRaw: 'A',
          originRegionCode: 'XIII',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'esperando_match',
        })
        .returning({ id: schema.trips.id }),
    );

    // La "edición": otra conexión toma la fila y cambia el peso sin commitear.
    const edicion = await handle.pool.connect();
    try {
      await edicion.query('BEGIN');
      await edicion.query('UPDATE viajes SET carga_peso_kg = 2500 WHERE id = $1', [viaje.id]);

      const matching = runMatching({ db: handle.db, logger, tripId: viaje.id });
      // Deja que el matching llegue a la lectura del viaje mientras la
      // edición sigue abierta.
      await new Promise((r) => setTimeout(r, 300));
      await edicion.query('COMMIT');
      await matching;
    } finally {
      edicion.release();
    }

    const [iniciado] = await handle.db
      .select({ payload: schema.tripEvents.payload })
      .from(schema.tripEvents)
      .where(
        and(
          eq(schema.tripEvents.tripId, viaje.id),
          eq(schema.tripEvents.eventType, 'matching_iniciado'),
        ),
      );
    expect(iniciado?.payload).toMatchObject({ cargo_weight_kg: 2500 });
  });
});
