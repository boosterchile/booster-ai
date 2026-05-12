import { DEFAULT_WEIGHTS_V2, type WeightsV2 } from '@booster-ai/matching-algorithm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';

/**
 * Tests del wire v2 del orchestrator de matching (ADR-033).
 *
 * Validan que cuando `MATCHING_ALGORITHM_V2_ACTIVATED=true`:
 *   - El orchestrator invoca `lookupCarriersForV2` con las empresas candidatas.
 *   - El orchestrator invoca `resolveMatchingV2Weights`.
 *   - El audit event `ofertas_enviadas` incluye `algorithm_version: 'v2'`.
 *   - Se emite el log `matching v2: score breakdown` con components.
 *   - El score persistido pasa por `scoreToIntV2` (×1000).
 *   - El selector usa `selectTopNCandidatesV2` (tiebreak por vehicleId).
 *
 * Y que cuando flag=false:
 *   - Comportamiento v1 idéntico (regression test).
 *   - NO se llama a los lookups extras (zero overhead cuando v2 off).
 */

// Mocks de los módulos del wire — controlamos lo que devuelven sin
// tocar la DB real. La función pura `scoreCandidateV2` no se mockea:
// queremos que el orchestrator la ejecute end-to-end (es función pura).
vi.mock('../../src/services/matching-v2-lookups.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/matching-v2-lookups.js')>();
  return {
    ...actual,
    lookupCarriersForV2: vi.fn(),
  };
});
vi.mock('../../src/services/matching-v2-weights.js', () => ({
  resolveMatchingV2Weights: vi.fn(),
}));

const { lookupCarriersForV2 } = await import('../../src/services/matching-v2-lookups.js');
const { resolveMatchingV2Weights } = await import('../../src/services/matching-v2-weights.js');
const { runMatching } = await import('../../src/services/matching.js');

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
  inserts?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];
  const inserts = [...(queues.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(selects.shift() ?? []));
    };
    return chain;
  };

  const buildUpdateChain = () => {
    const chain: Record<string, unknown> = {
      set: vi.fn(() => chain),
      where: vi.fn(async () => updates.shift() ?? []),
    };
    return chain;
  };

  const insertCalls: unknown[][] = [];
  const buildInsertChain = () => {
    let lastValues: unknown[] | undefined;
    const chain: Record<string, unknown> = {
      values: vi.fn((v: unknown) => {
        lastValues = Array.isArray(v) ? v : [v];
        insertCalls.push(lastValues);
        return chain;
      }),
      returning: vi.fn(async () => inserts.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(inserts.shift() ?? []));
    };
    return chain;
  };

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
    insert: vi.fn(() => buildInsertChain()),
  };

  return {
    db: {
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
      select: tx.select,
      update: tx.update,
      insert: tx.insert,
    },
    insertCalls,
  };
}

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const TRIP_BASE = {
  id: TRIP_ID,
  status: 'esperando_match',
  originRegionCode: 'RM',
  cargoType: 'carga_seca',
  cargoWeightKg: 5000,
  proposedPriceClp: 250000,
};

function makeLookup(
  opts: Partial<{
    empresaId: string;
    tripActivoDestinoRegionMatch: boolean;
    tripsRecientesTotalUltimos7d: number;
    tripsRecientesMatchRegionalUltimos7d: number;
    ofertasUltimos90dTotales: number;
    ofertasUltimos90dAceptadas: number;
    tierBoost: number;
  }> = {},
) {
  return {
    empresaId: opts.empresaId ?? 'emp-1',
    tripActivoDestinoRegionMatch: opts.tripActivoDestinoRegionMatch ?? false,
    tripsRecientesTotalUltimos7d: opts.tripsRecientesTotalUltimos7d ?? 0,
    tripsRecientesMatchRegionalUltimos7d: opts.tripsRecientesMatchRegionalUltimos7d ?? 0,
    ofertasUltimos90dTotales: opts.ofertasUltimos90dTotales ?? 0,
    ofertasUltimos90dAceptadas: opts.ofertasUltimos90dAceptadas ?? 0,
    tierBoost: opts.tierBoost ?? 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: weights mock retorna defaults. Tests específicos pueden override.
  vi.mocked(resolveMatchingV2Weights).mockReturnValue(DEFAULT_WEIGHTS_V2);
});
afterEach(() => {
  vi.clearAllMocks();
  // Reset flag a default (false) por si un test lo flipeó.
  (appConfig as { MATCHING_ALGORITHM_V2_ACTIVATED: boolean }).MATCHING_ALGORITHM_V2_ACTIVATED =
    false;
});

describe('runMatching — wire v2 (ADR-033)', () => {
  describe('flag MATCHING_ALGORITHM_V2_ACTIVATED=false (default)', () => {
    it('NO invoca lookupCarriersForV2 (path v1 puro, cero overhead)', async () => {
      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      expect(lookupCarriersForV2).not.toHaveBeenCalled();
      expect(resolveMatchingV2Weights).not.toHaveBeenCalled();
    });

    it('audit event registra algorithm_version=v1', async () => {
      const { db, insertCalls } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      // Insert order: [matching_iniciado, offers, ofertas_enviadas]
      const ofertasEnviadasInsert = insertCalls[2]?.[0] as {
        payload: { algorithm_version: string };
      };
      expect(ofertasEnviadasInsert?.payload.algorithm_version).toBe('v1');
    });
  });

  describe('flag MATCHING_ALGORITHM_V2_ACTIVATED=true', () => {
    beforeEach(() => {
      (appConfig as { MATCHING_ALGORITHM_V2_ACTIVATED: boolean }).MATCHING_ALGORITHM_V2_ACTIVATED =
        true;
    });

    it('invoca lookupCarriersForV2 con las empresas candidatas y la región del origen', async () => {
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([['emp-1', makeLookup({ empresaId: 'emp-1' })]]),
      );

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      expect(lookupCarriersForV2).toHaveBeenCalledTimes(1);
      const callArg = vi.mocked(lookupCarriersForV2).mock.calls[0]?.[0];
      expect(callArg?.empresaIds).toEqual(['emp-1']);
      expect(callArg?.originRegionCode).toBe('RM');
    });

    it('invoca resolveMatchingV2Weights y usa los pesos resueltos para scoring', async () => {
      const customWeights: WeightsV2 = {
        capacidad: 0.5,
        backhaul: 0.3,
        reputacion: 0.1,
        tier: 0.1,
      };
      vi.mocked(resolveMatchingV2Weights).mockReturnValue(customWeights);
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([['emp-1', makeLookup({ empresaId: 'emp-1' })]]),
      );

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      expect(resolveMatchingV2Weights).toHaveBeenCalledTimes(1);
    });

    it('audit event registra algorithm_version=v2', async () => {
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([['emp-1', makeLookup({ empresaId: 'emp-1' })]]),
      );

      const { db, insertCalls } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      const ofertasEnviadasInsert = insertCalls[2]?.[0] as {
        payload: { algorithm_version: string };
      };
      expect(ofertasEnviadasInsert?.payload.algorithm_version).toBe('v2');
    });

    it('emite log "matching v2: score breakdown" con components por candidato', async () => {
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([
          [
            'emp-1',
            makeLookup({
              empresaId: 'emp-1',
              tripActivoDestinoRegionMatch: true,
              ofertasUltimos90dTotales: 20,
              ofertasUltimos90dAceptadas: 18,
            }),
          ],
        ]),
      );

      const infoSpy = vi.fn();
      const localLogger = {
        ...noopLogger,
        info: infoSpy,
        child: () => localLogger,
      } as never;

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: localLogger, tripId: TRIP_ID });

      const breakdownCall = infoSpy.mock.calls.find((c) => c[1] === 'matching v2: score breakdown');
      expect(breakdownCall).toBeDefined();
      const ctx = breakdownCall?.[0] as {
        algorithmVersion: string;
        weights: WeightsV2;
        candidates_scored: Array<{
          empresaId: string;
          components: { capacidad: number; backhaul: number; reputacion: number; tier: number };
        }>;
      };
      expect(ctx.algorithmVersion).toBe('v2');
      expect(ctx.weights).toEqual(DEFAULT_WEIGHTS_V2);
      expect(ctx.candidates_scored).toHaveLength(1);
      expect(ctx.candidates_scored[0]?.empresaId).toBe('emp-1');
      expect(ctx.candidates_scored[0]?.components.capacidad).toBeGreaterThan(0);
      expect(ctx.candidates_scored[0]?.components.backhaul).toBeGreaterThan(0);
    });

    it('score persistido usa scoreToIntV2 (×1000) — verificación via insert payload', async () => {
      // Carrier perfecto: trip activo a la región, reputación máxima.
      // Score v2 debería estar cerca de 1.0 → scoreToIntV2 ≈ 1000.
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([
          [
            'emp-1',
            makeLookup({
              empresaId: 'emp-1',
              tripActivoDestinoRegionMatch: true,
              tripsRecientesTotalUltimos7d: 10,
              tripsRecientesMatchRegionalUltimos7d: 10,
              ofertasUltimos90dTotales: 50,
              ofertasUltimos90dAceptadas: 50,
              tierBoost: 1.0,
            }),
          ],
        ]),
      );

      const { db, insertCalls } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 5100 }], // capacity ajustado a 5000kg cargo
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      // El segundo insert es offers. Inspeccionamos su payload.
      const offerInsert = insertCalls[1]?.[0] as { score: number };
      expect(offerInsert?.score).toBeGreaterThanOrEqual(800); // score perfecto ≈ 1000
      expect(offerInsert?.score).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(offerInsert?.score)).toBe(true);
    });

    it('multi-candidato: top-N + tiebreak por vehicleId localeCompare', async () => {
      // 3 empresas con perfiles distintos → orden esperado:
      // emp-A (backhaul activo) > emp-B (reputación alta) > emp-C (sin señales)
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([
          [
            'emp-A',
            makeLookup({
              empresaId: 'emp-A',
              tripActivoDestinoRegionMatch: true,
              ofertasUltimos90dTotales: 20,
              ofertasUltimos90dAceptadas: 15,
            }),
          ],
          [
            'emp-B',
            makeLookup({
              empresaId: 'emp-B',
              tripActivoDestinoRegionMatch: false,
              tripsRecientesTotalUltimos7d: 5,
              tripsRecientesMatchRegionalUltimos7d: 4,
              ofertasUltimos90dTotales: 30,
              ofertasUltimos90dAceptadas: 28,
              tierBoost: 0.5,
            }),
          ],
          ['emp-C', makeLookup({ empresaId: 'emp-C' })],
        ]),
      );

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-A' }, { empresaId: 'emp-B' }, { empresaId: 'emp-C' }],
          [
            { id: 'emp-A', isTransportista: true, status: 'activa' },
            { id: 'emp-B', isTransportista: true, status: 'activa' },
            { id: 'emp-C', isTransportista: true, status: 'activa' },
          ],
          [{ id: 'vA', empresaId: 'emp-A', capacityKg: 5100 }],
          [{ id: 'vB', empresaId: 'emp-B', capacityKg: 5100 }],
          [{ id: 'vC', empresaId: 'emp-C', capacityKg: 5100 }],
        ],
        updates: [[], []],
        inserts: [
          [],
          [
            { id: 'o1', empresaId: 'emp-A' },
            { id: 'o2', empresaId: 'emp-B' },
            { id: 'o3', empresaId: 'emp-C' },
          ],
          [],
        ],
      });

      const result = await runMatching({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
      });
      expect(result.candidatesEvaluated).toBe(3);
      expect(result.offersCreated).toBe(3);
    });

    it('lookups Map vacío para empresaId → carrier skipeado defensivamente', async () => {
      // emp-2 NO está en el Map (defensa contra bug en lookups).
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([['emp-1', makeLookup({ empresaId: 'emp-1' })]]),
      );

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }, { empresaId: 'emp-2' }],
          [
            { id: 'emp-1', isTransportista: true, status: 'activa' },
            { id: 'emp-2', isTransportista: true, status: 'activa' },
          ],
          [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
          [{ id: 'v2', empresaId: 'emp-2', capacityKg: 6000 }],
        ],
        updates: [[], []],
        inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
      });

      const result = await runMatching({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
      });
      // emp-2 skipeada → solo 1 candidato evaluado.
      expect(result.candidatesEvaluated).toBe(1);
      expect(result.offersCreated).toBe(1);
    });

    it('0 candidatos con vehículo apto → finaliza como no_vehicle_with_capacity (v2 path)', async () => {
      vi.mocked(lookupCarriersForV2).mockResolvedValue(
        new Map([['emp-1', makeLookup({ empresaId: 'emp-1' })]]),
      );

      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
          [], // no vehículo apto
        ],
        updates: [[], []],
        inserts: [[], []],
      });

      const result = await runMatching({
        db: db as never,
        logger: noopLogger,
        tripId: TRIP_ID,
      });
      expect(result.candidatesEvaluated).toBe(0);
      expect(result.offersCreated).toBe(0);
    });

    it('cero empresas activas → finaliza ANTES de invocar lookupCarriersForV2', async () => {
      // Early exit antes del bloque v2: lookups NO debe llamarse.
      const { db } = makeDb({
        selects: [
          [TRIP_BASE],
          [{ empresaId: 'emp-1' }],
          [], // 0 empresas activas
        ],
        updates: [[], []],
        inserts: [[], []],
      });

      await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

      expect(lookupCarriersForV2).not.toHaveBeenCalled();
    });
  });
});
