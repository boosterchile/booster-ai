import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TripNotFoundError,
  calcularMetricasEstimadas,
} from '../../src/services/calcular-metricas-viaje.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
}

/**
 * Mock de db.transaction(cb) + tx.select/insert/update con cadenas
 * fluent thenable. La transaction simplemente invoca el callback con
 * el mismo tx y devuelve su valor (no hay rollback en mock).
 */
function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updates = [...(opts.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(async () => inserts.shift() ?? []),
  });

  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => updates.shift() ?? []),
    })),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    ...tx,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const VEH_ID = '22222222-2222-2222-2222-222222222222';

const TRIP_BASE = {
  id: TRIP_ID,
  cargoWeightKg: 5000,
  originRegionCode: 'RM',
  destinationRegionCode: 'V',
};

describe('calcularMetricasEstimadas', () => {
  it('throw TripNotFoundError si trip no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      calcularMetricasEstimadas({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
        vehicleId: null,
      }),
    ).rejects.toThrow(TripNotFoundError);
  });

  it('vehicleId=null → modo por_defecto camion_mediano + INSERT initial', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE], // SELECT trip
        [], // SELECT existing tripMetrics → vacío
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.tripId).toBe(TRIP_ID);
    expect(result.isInitialCalculation).toBe(true);
    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
    expect(result.emisiones.emisionesKgco2eWtw).toBeGreaterThan(0);
  });

  it('vehículo con perfil completo → modo modelado', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: 'diesel_b5',
            consumptionLPer100kmBaseline: '28.5',
            curbWeightKg: 7000,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [], // tripMetrics existing vacío
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('modelado');
    expect(result.isInitialCalculation).toBe(true);
  });

  it('vehículo SIN perfil completo (falta consumo) → cae a modo por_defecto', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [
          {
            id: VEH_ID,
            fuelType: 'diesel_b5',
            consumptionLPer100kmBaseline: null, // falta perfil
            curbWeightKg: null,
            capacityKg: 12000,
            vehicleType: 'camion_pequeno',
          },
        ],
        [],
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
  });

  it('vehicleId no encontrado en BD → fallback por_defecto camion_mediano', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [], // SELECT vehicles vacío
        [],
      ],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: VEH_ID,
    });

    expect(result.emisiones.metodoPrecision).toBe('por_defecto');
  });

  it('tripMetrics ya existe → UPDATE, isInitialCalculation=false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ tripId: TRIP_ID }], // tripMetrics existente
      ],
      updates: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.isInitialCalculation).toBe(false);
    expect(db.update).toHaveBeenCalled();
  });

  it('cargo_weight_kg null → trata como 0', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, cargoWeightKg: null }], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.emisiones.distanciaKm).toBeGreaterThan(0);
  });

  it('region codes null → distancia default 500 km usado en cálculo', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, originRegionCode: null, destinationRegionCode: null }], []],
      inserts: [[]],
    });

    const result = await calcularMetricasEstimadas({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      vehicleId: null,
    });

    expect(result.emisiones.distanciaKm).toBe(500);
  });
});
