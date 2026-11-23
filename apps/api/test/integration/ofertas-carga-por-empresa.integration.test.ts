import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { runMatching } from '../../src/services/matching.js';
import {
  cambiarOfertasCarga,
  listarTransportistasOfertasCarga,
} from '../../src/services/ofertas-carga-por-empresa.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/servicios-por-empresa`: una empresa transportista sin el servicio
 * de ofertas de carga no es candidata del matching, y el platform-admin lo
 * cambia dejando registro.
 */
describe('integration: ofertas de carga por empresa', () => {
  let handle: TestDbHandle;
  let planId: string;
  let generadoraId: string;
  let duenoId: string;

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

  function uno<T>(rows: T[]): T {
    const r = rows[0];
    if (!r) {
      throw new Error('fixture no creado');
    }
    return r;
  }

  async function crearEmpresa(transportista: boolean) {
    return uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa ${randomUUID().slice(0, 8)}`,
          rut: rutAleatorio(),
          contactEmail: `${randomUUID().slice(0, 8)}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Coquimbo',
          addressRegion: 'IV',
          isTransportista: transportista,
          isGeneradorCarga: !transportista,
          status: 'activa',
          planId,
        })
        .returning(),
    );
  }

  beforeAll(async () => {
    handle = createTestDb();
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
    planId =
      plan?.id ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).id;
    generadoraId = (await crearEmpresa(false)).id;
    const sufijo = randomUUID().slice(0, 8);
    duenoId = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${sufijo}`,
          email: `${sufijo}@test.invalid`,
          fullName: 'Dueña',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
    ).id;
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Región propia: las zonas de otras suites no aportan candidatas. */
  async function regionLibre(): Promise<string> {
    for (let intento = 0; intento < 64; intento++) {
      const region = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
      const ocupada = await handle.db
        .select({ id: schema.zones.id })
        .from(schema.zones)
        .where(eq(schema.zones.regionCode, region))
        .limit(1);
      if (ocupada.length === 0) {
        return region;
      }
    }
    throw new Error('fixture: no hay regionCode libre');
  }

  /** Transportista con zona en la región y un camión que sirve, más una carga por emparejar. */
  async function escenario() {
    const { db } = handle;
    const region = await regionLibre();
    const transportista = await crearEmpresa(true);
    await db.insert(schema.zones).values({
      empresaId: transportista.id,
      regionCode: region,
      zoneType: 'recogida',
    });
    await db.insert(schema.vehicles).values({
      empresaId: transportista.id,
      plate: randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase(),
      vehicleType: 'camion_mediano',
      unitType: 'camion_rigido',
      capacityKg: 10_000,
    });
    const crearViaje = async () =>
      uno(
        await db
          .insert(schema.trips)
          .values({
            trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
            generadorCargaEmpresaId: generadoraId,
            createdByUserId: duenoId,
            originAddressRaw: 'A',
            originRegionCode: region,
            destinationAddressRaw: 'B',
            pickupDateRaw: '2026-11-24',
            status: 'esperando_match',
            cargoType: 'carga_seca',
            cargoWeightKg: 5_000,
          })
          .returning({ id: schema.trips.id }),
      ).id;
    return { transportistaId: transportista.id, crearViaje };
  }

  const ofertasDe = (tripId: string) =>
    handle.db
      .select({ empresaId: schema.offers.empresaId })
      .from(schema.offers)
      .where(eq(schema.offers.tripId, tripId));

  test('una empresa nace recibiendo ofertas de carga, sin registro de cambio', async () => {
    const e = await crearEmpresa(true);
    expect(e).toMatchObject({
      recibeOfertasCarga: true,
      recibeOfertasCargaCambiadoEn: null,
      recibeOfertasCargaCambiadoPor: null,
    });
  });

  test('con el servicio apagado el matching no le ofrece la carga; al encenderlo, sí', async () => {
    const e = await escenario();
    await cambiarOfertasCarga({
      db: handle.db,
      empresaId: e.transportistaId,
      activo: false,
      adminEmail: 'admin@boosterchile.com',
    });

    const apagado = await e.crearViaje();
    await runMatching({ db: handle.db, logger, tripId: apagado, elegibilidad: 'vigente' });
    expect(await ofertasDe(apagado)).toEqual([]);

    await cambiarOfertasCarga({
      db: handle.db,
      empresaId: e.transportistaId,
      activo: true,
      adminEmail: 'admin@boosterchile.com',
    });
    const encendido = await e.crearViaje();
    await runMatching({ db: handle.db, logger, tripId: encendido, elegibilidad: 'vigente' });
    expect(await ofertasDe(encendido)).toEqual([{ empresaId: e.transportistaId }]);
  });

  test('con la elegibilidad por carga activa tampoco le ofrece', async () => {
    const e = await escenario();
    await cambiarOfertasCarga({
      db: handle.db,
      empresaId: e.transportistaId,
      activo: false,
      adminEmail: 'admin@boosterchile.com',
    });
    const viaje = await e.crearViaje();
    await runMatching({ db: handle.db, logger, tripId: viaje, elegibilidad: 'activa' });
    expect(await ofertasDe(viaje)).toEqual([]);
  });

  test('el cambio registra quién y cuándo, y aparece en la lista', async () => {
    const e = await crearEmpresa(true);
    const apagada = await cambiarOfertasCarga({
      db: handle.db,
      empresaId: e.id,
      activo: false,
      adminEmail: 'admin@boosterchile.com',
    });
    expect(apagada).toMatchObject({
      empresaId: e.id,
      activo: false,
      cambiadoPor: 'admin@boosterchile.com',
    });
    expect(apagada?.cambiadoEn).toBeInstanceOf(Date);

    const lista = await listarTransportistasOfertasCarga(handle.db);
    expect(lista.find((t) => t.empresaId === e.id)).toMatchObject({ activo: false });
  });

  test('una empresa que no es transportista no se puede cambiar (null) ni se lista', async () => {
    const g = await crearEmpresa(false);
    expect(
      await cambiarOfertasCarga({
        db: handle.db,
        empresaId: g.id,
        activo: false,
        adminEmail: 'admin@boosterchile.com',
      }),
    ).toBeNull();
    const lista = await listarTransportistasOfertasCarga(handle.db);
    expect(lista.some((t) => t.empresaId === g.id)).toBe(false);
  });
});
