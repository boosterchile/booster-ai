import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actualizarFactorMatchingViaje } from '../../src/services/actualizar-factor-matching.js';

/**
 * Tests del recálculo post-entrega de empty backhaul (ADR-021 §6.4).
 * Heurística v1: factorMatching = 1 si el next trip del vehículo arranca
 * en la misma región del destino actual, sino 0.
 */

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
  updates?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const updates = [...(opts.updates ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };
  const buildUpdateChain = () => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => updates.shift() ?? []),
    })),
  });
  return {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const VEH_ID = '22222222-2222-2222-2222-222222222222';

const TRIP_VALPARAISO_DESTINO = {
  id: TRIP_ID,
  destinationRegionCode: 'V',
  destinationAddressRaw: 'Plaza Sotomayor, Valparaíso',
};

const ASSIGNMENT_OK = {
  vehicleId: VEH_ID,
  deliveredAt: new Date('2026-05-05T18:00:00Z'),
};

const VEH_COMPLETO = {
  fuelType: 'diesel',
  consumptionLPer100kmBaseline: '28.5',
  capacityKg: 12000,
};

const METRICS_OK = {
  distanceKmEstimated: '120',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('actualizarFactorMatchingViaje — no-op branches', () => {
  it('trip no existe → recomputed:false', async () => {
    const db = makeDb({ selects: [[]] });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });

  it('sin assignment con vehicle+deliveredAt → recomputed:false', async () => {
    const db = makeDb({
      selects: [[TRIP_VALPARAISO_DESTINO], [{ vehicleId: null, deliveredAt: null }]],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });

  it('vehículo sin perfil energético completo → recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_VALPARAISO_DESTINO],
        [ASSIGNMENT_OK],
        [{ fuelType: null, consumptionLPer100kmBaseline: null, capacityKg: null }],
      ],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });

  it('trip sin métricas previas → warn + recomputed:false', async () => {
    const db = makeDb({
      selects: [
        [TRIP_VALPARAISO_DESTINO],
        [ASSIGNMENT_OK],
        [VEH_COMPLETO],
        [], // tripMetrics vacío
      ],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(false);
  });
});

describe('actualizarFactorMatchingViaje — heurística geo', () => {
  it('next trip arranca en MISMA región del destino → factorMatching=1, ahorro>0', async () => {
    const db = makeDb({
      selects: [
        [TRIP_VALPARAISO_DESTINO],
        [ASSIGNMENT_OK],
        [VEH_COMPLETO],
        [METRICS_OK],
        [
          // Next trip arranca en Valparaíso (región V) → match pleno.
          { tripId: 'next-trip', originRegionCode: 'V' },
        ],
      ],
      updates: [[]],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(true);
    expect(result.factorMatching).toBe(1);
    expect(result.ahorroCo2eKgWtw).toBeGreaterThan(0);
  });

  it('next trip arranca en OTRA región → factorMatching=0', async () => {
    const db = makeDb({
      selects: [
        [TRIP_VALPARAISO_DESTINO],
        [ASSIGNMENT_OK],
        [VEH_COMPLETO],
        [METRICS_OK],
        [
          // Next trip arranca en Concepción (región VIII) ≠ Valparaíso (V).
          { tripId: 'next-trip', originRegionCode: 'VIII' },
        ],
      ],
      updates: [[]],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(true);
    expect(result.factorMatching).toBe(0);
    expect(result.ahorroCo2eKgWtw).toBe(0);
  });

  it('sin next trip en la ventana de 7d → factorMatching=0, igual persiste', async () => {
    const db = makeDb({
      selects: [
        [TRIP_VALPARAISO_DESTINO],
        [ASSIGNMENT_OK],
        [VEH_COMPLETO],
        [METRICS_OK],
        [], // no next trips
      ],
      updates: [[]],
    });
    const result = await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.recomputed).toBe(true);
    expect(result.factorMatching).toBe(0);
  });
});

describe('actualizarFactorMatchingViaje — persistencia', () => {
  it('persiste los 3 campos con factorMatching=1', async () => {
    const setMock = vi.fn(() => ({ where: vi.fn(async () => []) }));
    const db = {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: vi.fn(() => chain),
          innerJoin: vi.fn(() => chain),
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(async () => {
            const queue: unknown[][] = [
              [TRIP_VALPARAISO_DESTINO],
              [ASSIGNMENT_OK],
              [VEH_COMPLETO],
              [METRICS_OK],
              [{ tripId: 'next', originRegionCode: 'V' }],
            ];
            return queue[(db.select as ReturnType<typeof vi.fn>).mock.calls.length - 1] ?? [];
          }),
        };
        return chain;
      }),
      update: vi.fn(() => ({ set: setMock })),
    };
    await actualizarFactorMatchingViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(setMock).toHaveBeenCalledTimes(1);
    const setArg = setMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.factorMatchingAplicado).toBe('1.00');
    expect(Number(setArg.emisionesEmptyBackhaulKgco2eWtw)).toBe(0); // factor 1 → 0 attribution
    expect(Number(setArg.ahorroCo2eVsSinMatchingKgco2e)).toBeGreaterThan(0);
  });
});
