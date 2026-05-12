import { describe, expect, it, vi } from 'vitest';
import {
  type CarrierLookupAggregate,
  buildCandidateV2,
  lookupCarriersForV2,
} from '../../src/services/matching-v2-lookups.js';

/**
 * Tests del lookup batch SQL del wire v2 (ADR-033 §3).
 *
 * Mockean el db Drizzle con 4 chains thenable encadenadas — 1 por query
 * (trips activos, histórico 7d, reputación 90d, tier). Validan que:
 *   - Cada empresa recibe defaults zeros cuando no tiene actividad.
 *   - El Map devuelto tiene entry por TODAS las empresaIds del input.
 *   - tripActivoDestinoRegionMatch=true sólo si query 1 devuelve algo.
 *   - El tier slug se mapea via tierBoostFromSlug.
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

interface QueryQueue {
  /** Resultados secuenciales de las 4 select chains. */
  results: unknown[][];
}

function makeDb(queue: QueryQueue) {
  const results = [...queue.results];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => results.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(results.shift() ?? []));
    };
    return chain;
  };

  return {
    select: vi.fn(() => buildSelectChain()),
  };
}

describe('lookupCarriersForV2', () => {
  it('empresaIds vacío → retorna Map vacío sin tocar db', async () => {
    const db = makeDb({ results: [] });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: [],
      originRegionCode: 'RM',
    });
    expect(result.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('empresa sin actividad → defaults zeros + tier 0', async () => {
    const db = makeDb({
      results: [
        [], // trips activos
        [], // histórico 7d
        [], // reputación 90d
        [], // tier
      ],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    expect(result.size).toBe(1);
    const lookup = result.get('emp-1');
    expect(lookup).toEqual({
      empresaId: 'emp-1',
      tripActivoDestinoRegionMatch: false,
      tripsRecientesTotalUltimos7d: 0,
      tripsRecientesMatchRegionalUltimos7d: 0,
      ofertasUltimos90dTotales: 0,
      ofertasUltimos90dAceptadas: 0,
      tierBoost: 0,
    });
  });

  it('empresa con trip activo destino=RM → tripActivoDestinoRegionMatch=true', async () => {
    const db = makeDb({
      results: [[{ empresaCarrierId: 'emp-1' }], [], [], []],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    expect(result.get('emp-1')?.tripActivoDestinoRegionMatch).toBe(true);
  });

  it('empresa con histórico 7d → propaga total + matchRegional', async () => {
    const db = makeDb({
      results: [
        [],
        [
          {
            empresaId: 'emp-1',
            totalUltimos7d: 12,
            matchRegionalUltimos7d: 8,
          },
        ],
        [],
        [],
      ],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    const lookup = result.get('emp-1');
    expect(lookup?.tripsRecientesTotalUltimos7d).toBe(12);
    expect(lookup?.tripsRecientesMatchRegionalUltimos7d).toBe(8);
  });

  it('empresa con reputación 90d → propaga totales + aceptadas', async () => {
    const db = makeDb({
      results: [
        [],
        [],
        [
          {
            empresaId: 'emp-1',
            totales: 25,
            aceptadas: 22,
          },
        ],
        [],
      ],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    const lookup = result.get('emp-1');
    expect(lookup?.ofertasUltimos90dTotales).toBe(25);
    expect(lookup?.ofertasUltimos90dAceptadas).toBe(22);
  });

  it('empresa con tier premium → tierBoost > 0', async () => {
    const db = makeDb({
      results: [[], [], [], [{ empresaId: 'emp-1', tierSlug: 'premium' }]],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    expect(result.get('emp-1')?.tierBoost).toBeGreaterThan(0);
  });

  it('tier slug desconocido → tierBoost 0 (defensa contra schema drift)', async () => {
    const db = makeDb({
      results: [[], [], [], [{ empresaId: 'emp-1', tierSlug: 'tier-inexistente' }]],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    expect(result.get('emp-1')?.tierBoost).toBe(0);
  });

  it('múltiples empresas con perfiles distintos — Map completo', async () => {
    const db = makeDb({
      results: [
        [{ empresaCarrierId: 'emp-A' }], // trip activo
        [
          { empresaId: 'emp-A', totalUltimos7d: 10, matchRegionalUltimos7d: 7 },
          { empresaId: 'emp-B', totalUltimos7d: 3, matchRegionalUltimos7d: 0 },
        ],
        [
          { empresaId: 'emp-A', totales: 20, aceptadas: 18 },
          { empresaId: 'emp-C', totales: 5, aceptadas: 1 },
        ],
        [
          { empresaId: 'emp-A', tierSlug: 'premium' },
          { empresaId: 'emp-B', tierSlug: 'pro' },
          { empresaId: 'emp-C', tierSlug: 'standard' },
        ],
      ],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-A', 'emp-B', 'emp-C'],
      originRegionCode: 'RM',
    });
    expect(result.size).toBe(3);
    expect(result.get('emp-A')?.tripActivoDestinoRegionMatch).toBe(true);
    expect(result.get('emp-A')?.ofertasUltimos90dAceptadas).toBe(18);
    expect(result.get('emp-B')?.tripActivoDestinoRegionMatch).toBe(false);
    expect(result.get('emp-B')?.tripsRecientesTotalUltimos7d).toBe(3);
    expect(result.get('emp-C')?.ofertasUltimos90dTotales).toBe(5);
    // Tier boosts deben ser monotónicos: premium >= pro >= standard >= 0
    const tierA = result.get('emp-A')?.tierBoost ?? 0;
    const tierB = result.get('emp-B')?.tierBoost ?? 0;
    const tierC = result.get('emp-C')?.tierBoost ?? 0;
    expect(tierA).toBeGreaterThanOrEqual(tierB);
    expect(tierB).toBeGreaterThanOrEqual(tierC);
  });

  it('count/sum NULL desde SQL (sin filas) → coalesce a 0', async () => {
    const db = makeDb({
      results: [
        [],
        [
          {
            empresaId: 'emp-1',
            totalUltimos7d: null,
            matchRegionalUltimos7d: null,
          },
        ],
        [
          {
            empresaId: 'emp-1',
            totales: null,
            aceptadas: null,
          },
        ],
        [],
      ],
    });
    const result = await lookupCarriersForV2({
      db: db as never,
      logger: noopLogger,
      empresaIds: ['emp-1'],
      originRegionCode: 'RM',
    });
    const lookup = result.get('emp-1');
    expect(lookup?.tripsRecientesTotalUltimos7d).toBe(0);
    expect(lookup?.tripsRecientesMatchRegionalUltimos7d).toBe(0);
    expect(lookup?.ofertasUltimos90dTotales).toBe(0);
    expect(lookup?.ofertasUltimos90dAceptadas).toBe(0);
  });
});

describe('buildCandidateV2', () => {
  it('combina lookup + vehicle data en el shape CarrierCandidateV2 que scoreCandidateV2 espera', () => {
    const lookup: CarrierLookupAggregate = {
      empresaId: 'emp-1',
      tripActivoDestinoRegionMatch: true,
      tripsRecientesTotalUltimos7d: 5,
      tripsRecientesMatchRegionalUltimos7d: 4,
      ofertasUltimos90dTotales: 30,
      ofertasUltimos90dAceptadas: 25,
      tierBoost: 0.5,
    };
    const candidate = buildCandidateV2({
      empresaId: 'emp-1',
      vehicleId: 'veh-1',
      vehicleCapacityKg: 6000,
      lookup,
    });
    expect(candidate).toEqual({
      empresaId: 'emp-1',
      vehicleId: 'veh-1',
      vehicleCapacityKg: 6000,
      tripActivoDestinoRegionMatch: true,
      tripsRecientes: {
        totalUltimos7d: 5,
        matchRegionalUltimos7d: 4,
      },
      ofertasUltimos90d: {
        totales: 30,
        aceptadas: 25,
      },
      tierBoost: 0.5,
    });
  });
});
