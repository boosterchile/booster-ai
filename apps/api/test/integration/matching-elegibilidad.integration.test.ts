import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import * as elegibilidad from '../../src/services/matching-elegibilidad.js';
import { runMatching } from '../../src/services/matching.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

// La carga de candidatas se envuelve para poder hacerla fallar en un test.
vi.mock('../../src/services/matching-elegibilidad.js', async (original) => {
  const real = await original<typeof import('../../src/services/matching-elegibilidad.js')>();
  return { ...real, cargarCandidatasPorCarga: vi.fn(real.cargarCandidatasPorCarga) };
});

/**
 * matching-desde-la-carga parte 2 (ADR-090) contra Postgres real: la
 * elegibilidad por carga corre en sombra, sin cambiar las ofertas, o decide
 * las ofertas cuando el modo es `activa`.
 */
describe('integration: elegibilidad por carga en el matching', () => {
  let handle: TestDbHandle;
  let planId: string;
  let generadoraId: string;
  let duenoId: string;

  const info = vi.fn();
  const error = vi.fn();
  const noop = (): void => undefined;
  const logger = {
    trace: noop,
    debug: noop,
    info,
    warn: noop,
    error,
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
    const id =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    planId = id;
    const suffix = randomUUID().slice(0, 8);
    generadoraId = (await crearEmpresa(`Generadora ${suffix}`, false)).id;
    duenoId = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `${suffix}@test.invalid`,
          fullName: 'Dueña',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
    ).id;
  });
  afterAll(async () => {
    await handle.pool.end();
  });
  beforeEach(() => {
    info.mockClear();
    error.mockClear();
  });

  async function crearEmpresa(nombre: string, transportista: boolean) {
    return uno(
      await handle.db
        .insert(schema.empresas)
        .values({
          legalName: nombre,
          rut: rutAleatorio(),
          contactEmail: `${randomUUID().slice(0, 8)}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: transportista,
          isGeneradorCarga: !transportista,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id }),
    );
  }

  type Vehiculo = Partial<schema.NewVehicleRow> & Pick<schema.NewVehicleRow, 'capacityKg'>;

  /**
   * Una región propia por escenario: las zonas de otros tests no aportan
   * candidatas. Devuelve la transportista con su flota y un viaje por emparejar.
   */
  async function escenario(opts: {
    flota: Vehiculo[];
    carga: Pick<schema.NewTripRow, 'cargoType' | 'cargoWeightKg'> &
      Partial<Pick<schema.NewTripRow, 'cargoVolumeM3'>>;
  }) {
    const { db } = handle;
    const region = `Z${randomUUID().slice(0, 3)}`;
    const transportista = await crearEmpresa(`Transportista ${region}`, true);
    await db.insert(schema.zones).values({
      empresaId: transportista.id,
      regionCode: region,
      zoneType: 'recogida',
    });
    const vehiculos: string[] = [];
    for (const [i, v] of opts.flota.entries()) {
      vehiculos.push(
        uno(
          await db
            .insert(schema.vehicles)
            .values({
              empresaId: transportista.id,
              plate: `${region.slice(1).toUpperCase()}${i}${randomUUID().slice(0, 2).toUpperCase()}`,
              vehicleType: 'camion_mediano',
              unitType: 'camion_rigido',
              ...v,
            })
            .returning({ id: schema.vehicles.id }),
        ).id,
      );
    }
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generadoraId,
          createdByUserId: duenoId,
          originAddressRaw: 'A',
          originRegionCode: region,
          destinationAddressRaw: 'B',
          pickupDateRaw: '2026-11-20',
          status: 'esperando_match',
          ...opts.carga,
        })
        .returning({ id: schema.trips.id }),
    );
    return { transportistaId: transportista.id, vehiculos, tripId: viaje.id };
  }

  const ofertas = (tripId: string) =>
    handle.db
      .select({
        empresaId: schema.offers.empresaId,
        suggestedVehicleId: schema.offers.suggestedVehicleId,
      })
      .from(schema.offers)
      .where(eq(schema.offers.tripId, tripId));

  const estado = async (tripId: string) =>
    uno(
      await handle.db
        .select({ status: schema.trips.status })
        .from(schema.trips)
        .where(eq(schema.trips.id, tripId)),
    ).status;

  const comparacion = () =>
    info.mock.calls.find(([, msg]) => msg === 'matching: elegibilidad por carga')?.[0];

  const FRIO_EN_TOLVA = {
    flota: [{ capacityKg: 10_000, bodyType: 'tolva' as const }],
    carga: { cargoType: 'refrigerada' as const, cargoWeightKg: 5_000 },
  };

  test('modo vigente: no calcula la elegibilidad por carga ni la registra', async () => {
    const e = await escenario(FRIO_EN_TOLVA);
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'vigente' });

    expect(await ofertas(e.tripId)).toHaveLength(1);
    expect(elegibilidad.cargarCandidatasPorCarga).not.toHaveBeenCalled();
    expect(comparacion()).toBeUndefined();
  });

  test('en sombra: las ofertas son las del matching vigente y la diferencia queda registrada', async () => {
    const e = await escenario(FRIO_EN_TOLVA);
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'sombra' });

    expect(await ofertas(e.tripId)).toEqual([
      { empresaId: e.transportistaId, suggestedVehicleId: e.vehiculos[0] },
    ]);
    expect(comparacion()).toMatchObject({
      tripId: e.tripId,
      modo: 'sombra',
      cargoType: 'refrigerada',
      coinciden: false,
      candidatasVigente: 1,
      candidatasPorCarga: 0,
      soloVigente: [e.transportistaId],
      soloPorCarga: [],
      vehiculoDistinto: [],
    });
  });

  test('en sombra: cuando las dos reglas coinciden, lo registra como coincidencia', async () => {
    const e = await escenario({
      flota: [{ capacityKg: 10_000 }],
      carga: { cargoType: 'carga_seca', cargoWeightKg: 5_000 },
    });
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'sombra' });

    expect(await ofertas(e.tripId)).toHaveLength(1);
    expect(comparacion()).toMatchObject({ coinciden: true, soloVigente: [], soloPorCarga: [] });
  });

  test('en sombra: si la elegibilidad por carga falla, el matching vigente sigue y el error queda registrado', async () => {
    const e = await escenario(FRIO_EN_TOLVA);
    vi.mocked(elegibilidad.cargarCandidatasPorCarga).mockRejectedValueOnce(new Error('falla'));
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'sombra' });

    expect(await ofertas(e.tripId)).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: e.tripId, err: expect.any(Error) }),
      expect.stringContaining('elegibilidad por carga'),
    );
  });

  test('activa: una carrocería que no sirve deja la carga sin ofertas', async () => {
    const e = await escenario(FRIO_EN_TOLVA);
    const r = await runMatching({
      db: handle.db,
      logger,
      tripId: e.tripId,
      elegibilidad: 'activa',
    });

    expect(r.offersCreated).toBe(0);
    expect(await ofertas(e.tripId)).toEqual([]);
    expect(await estado(e.tripId)).toBe('expirado');
    expect(comparacion()).toMatchObject({ modo: 'activa', soloVigente: [e.transportistaId] });
  });

  test('activa: sugiere la motriz de la configuración más chica que sirve', async () => {
    const e = await escenario({
      flota: [
        { capacityKg: 20_000, bodyType: 'refrigerado' },
        { capacityKg: 4_000, bodyType: 'tolva' },
        { capacityKg: 8_000, bodyType: 'refrigerado' },
      ],
      carga: { cargoType: 'refrigerada', cargoWeightKg: 3_000 },
    });
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'activa' });

    // El vigente habría sugerido la tolva de 4.000 kg, la más chica por peso.
    expect(await ofertas(e.tripId)).toEqual([
      { empresaId: e.transportistaId, suggestedVehicleId: e.vehiculos[2] },
    ]);
    expect(comparacion()).toMatchObject({ vehiculoDistinto: [e.transportistaId] });
  });

  test('activa: ofrece a quien llega con tracto y semirremolque, que el vigente dejaba fuera', async () => {
    const e = await escenario({
      flota: [
        { capacityKg: 1, unitType: 'tracto_camion' },
        {
          capacityKg: 28_000,
          unitCategory: 'arrastre',
          unitType: 'semirremolque',
          bodyType: 'cortina',
        },
      ],
      carga: { cargoType: 'carga_seca', cargoWeightKg: 20_000 },
    });
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'activa' });

    expect(await ofertas(e.tripId)).toEqual([
      { empresaId: e.transportistaId, suggestedVehicleId: e.vehiculos[0] },
    ]);
  });

  test('activa: un vehículo retirado no cuenta', async () => {
    const e = await escenario({
      flota: [{ capacityKg: 10_000, vehicleStatus: 'retirado' }],
      carga: { cargoType: 'carga_seca', cargoWeightKg: 5_000 },
    });
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'activa' });

    expect(await ofertas(e.tripId)).toEqual([]);
    const [evento] = await handle.db
      .select({ payload: schema.tripEvents.payload })
      .from(schema.tripEvents)
      .where(
        and(
          eq(schema.tripEvents.tripId, e.tripId),
          eq(schema.tripEvents.eventType, 'oferta_expirada'),
        ),
      );
    expect(evento?.payload).toMatchObject({ reason: 'no_vehicle_with_capacity' });
  });

  test('activa: el volumen declarado en los dos lados descarta al vehículo que no lo alcanza', async () => {
    const e = await escenario({
      flota: [{ capacityKg: 28_000, capacityM3: 50 }],
      carga: { cargoType: 'carga_seca', cargoWeightKg: 22_000, cargoVolumeM3: 100 },
    });
    await runMatching({ db: handle.db, logger, tripId: e.tripId, elegibilidad: 'activa' });

    expect(await ofertas(e.tripId)).toEqual([]);
  });
});
