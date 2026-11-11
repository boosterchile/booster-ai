import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as elegibilidad from '../../src/services/matching-elegibilidad.js';
import { runMatching } from '../../src/services/matching.js';

// La carga de candidatas se envuelve para poder hacerla fallar. El recorrido
// contra PostgreSQL está en test/integration/matching-elegibilidad.integration.test.ts.
vi.mock('../../src/services/matching-elegibilidad.js', async (original) => {
  const real = await original<typeof import('../../src/services/matching-elegibilidad.js')>();
  return { ...real, cargarCandidatasPorCarga: vi.fn(real.cargarCandidatasPorCarga) };
});

type Filas = Record<string, unknown>[];

/** Una consulta encadenable que resuelve a `filas`. */
function consulta(filas: Filas) {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    {
      from: () => cadena,
      where: () => cadena,
      orderBy: () => cadena,
      for: () => cadena,
      limit: () => cadena,
      set: () => cadena,
      returning: () => cadena,
    },
  );
  return cadena;
}

/** Base falsa: cada SELECT consume la siguiente respuesta; los INSERT quedan anotados. */
function baseFalsa(selects: Filas[]) {
  const cola = [...selects];
  const insertados: unknown[] = [];
  const tx = {
    select: vi.fn(() => consulta(cola.shift() ?? [])),
    update: vi.fn(() => consulta([{ id: 'cas-ok' }])),
    insert: vi.fn(() => ({
      values: vi.fn((filas: unknown) => {
        insertados.push(filas);
        return consulta(Array.isArray(filas) ? (filas as Filas) : []);
      }),
    })),
  };
  return {
    db: { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) } as never,
    /** Las ofertas son el único INSERT que llega como arreglo. */
    ofertas: () => (insertados.find((x) => Array.isArray(x)) ?? []) as Filas,
  };
}

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

const TRIP = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'esperando_match',
  originRegionCode: 'RM',
  cargoType: 'refrigerada',
  cargoWeightKg: 5_000,
  cargoVolumeM3: null,
  proposedPriceClp: 250_000,
};
const ZONAS = [{ empresaId: 'emp-1' }];
const EMPRESAS = [{ id: 'emp-1' }];
/** Lo que ve el matching vigente: una tolva con capacidad de sobra. */
const VEHICULOS_APTOS = [{ id: 'tolva', empresaId: 'emp-1', capacityKg: 10_000 }];
const unidad = (id: string, bodyType: string | null, capacityKg: number) => ({
  id,
  empresaId: 'emp-1',
  unitCategory: 'motriz',
  unitType: 'camion_rigido',
  bodyType,
  capacityKg,
  capacityM3: null,
});
const FLOTA_SOLO_TOLVA = [unidad('tolva', 'tolva', 10_000)];
const FLOTA_CON_FRIO = [unidad('frio', 'refrigerado', 12_000), unidad('tolva', 'tolva', 10_000)];

const correr = (flota: Filas, modo: elegibilidad.ModoElegibilidad) => {
  const base = baseFalsa([[TRIP], ZONAS, EMPRESAS, VEHICULOS_APTOS, flota]);
  return {
    base,
    resultado: runMatching({ db: base.db, logger, tripId: TRIP.id, elegibilidad: modo }),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runMatching con elegibilidad por carga', () => {
  it('vigente: no la calcula', async () => {
    const { base, resultado } = correr(FLOTA_SOLO_TOLVA, 'vigente');
    await resultado;

    expect(elegibilidad.cargarCandidatasPorCarga).not.toHaveBeenCalled();
    expect(base.ofertas()).toMatchObject([{ empresaId: 'emp-1', suggestedVehicleId: 'tolva' }]);
  });

  it('sombra: ofrece lo del vigente y registra la diferencia', async () => {
    const { base, resultado } = correr(FLOTA_SOLO_TOLVA, 'sombra');
    await resultado;

    expect(base.ofertas()).toMatchObject([{ empresaId: 'emp-1', suggestedVehicleId: 'tolva' }]);
    expect(info).toHaveBeenCalledWith(
      {
        tripId: TRIP.id,
        modo: 'sombra',
        cargoType: 'refrigerada',
        cargoWeightKg: 5_000,
        cargoVolumeM3: null,
        candidatasVigente: 1,
        candidatasPorCarga: 0,
        coinciden: false,
        soloVigente: ['emp-1'],
        soloPorCarga: [],
        vehiculoDistinto: [],
      },
      'matching: elegibilidad por carga',
    );
  });

  it('sombra: si el cálculo falla, ofrece lo del vigente y registra el error', async () => {
    vi.mocked(elegibilidad.cargarCandidatasPorCarga).mockRejectedValueOnce(new Error('falla'));
    const { base, resultado } = correr(FLOTA_SOLO_TOLVA, 'sombra');
    await resultado;

    expect(base.ofertas()).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: TRIP.id, modo: 'sombra', err: expect.any(Error) }),
      'matching: falló la elegibilidad por carga en sombra',
    );
  });

  it('activa: sin carrocería que sirva no hay ofertas', async () => {
    const { base, resultado } = correr(FLOTA_SOLO_TOLVA, 'activa');

    expect(await resultado).toMatchObject({ candidatesEvaluated: 0, offersCreated: 0 });
    expect(base.ofertas()).toEqual([]);
  });

  it('activa: ofrece con el vehículo que sirve para la carga, no con el más chico por peso', async () => {
    const { base, resultado } = correr(FLOTA_CON_FRIO, 'activa');
    await resultado;

    expect(base.ofertas()).toMatchObject([{ empresaId: 'emp-1', suggestedVehicleId: 'frio' }]);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ modo: 'activa', vehiculoDistinto: ['emp-1'] }),
      'matching: elegibilidad por carga',
    );
  });

  it('activa: si el cálculo falla, el matching falla; no decide con la regla anterior', async () => {
    vi.mocked(elegibilidad.cargarCandidatasPorCarga).mockRejectedValueOnce(new Error('falla'));
    const { base, resultado } = correr(FLOTA_SOLO_TOLVA, 'activa');

    await expect(resultado).rejects.toThrow('falla');
    expect(base.ofertas()).toEqual([]);
  });
});

describe('cargarCandidatasPorCarga', () => {
  const tx = (flota: Filas) => ({ select: vi.fn(() => consulta(flota)) }) as never;
  const trip = { cargoType: 'refrigerada', cargoWeightKg: 5_000, cargoVolumeM3: null } as const;

  it('sin empresas no consulta la flota', async () => {
    const t = tx([]);
    expect(await elegibilidad.cargarCandidatasPorCarga(t, { trip, empresaIds: [] })).toEqual([]);
    expect((t as unknown as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });

  it('agrupa la flota por empresa y conserva el orden de las empresas', async () => {
    const flota = [
      { ...unidad('b-frio', 'refrigerado', 8_000), empresaId: 'emp-b' },
      { ...unidad('a-tolva', 'tolva', 9_000), empresaId: 'emp-a' },
      { ...unidad('c-frio', 'refrigerado', 6_000), empresaId: 'emp-c' },
    ];
    expect(
      await elegibilidad.cargarCandidatasPorCarga(tx(flota), {
        trip,
        empresaIds: ['emp-c', 'emp-a', 'emp-b', 'emp-sin-flota'],
      }),
    ).toEqual([
      { empresaId: 'emp-c', vehicleId: 'c-frio', vehicleCapacityKg: 6_000 },
      { empresaId: 'emp-b', vehicleId: 'b-frio', vehicleCapacityKg: 8_000 },
    ]);
  });
});
