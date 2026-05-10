import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OfferExpiredError,
  OfferNotFoundError,
  OfferNotOwnedError,
  OfferNotPendingError,
  acceptOffer,
  rejectOffer,
} from '../../src/services/offer-actions.js';

// Mock calcularMetricasEstimadas porque el accept hace fire-and-forget post-commit
// que requiere su propia mock infra; no queremos que falle el test del accept.
vi.mock('../../src/services/calcular-metricas-viaje.js', () => ({
  calcularMetricasEstimadas: vi.fn(async () => ({
    tripId: 'trip-1',
    isInitialCalculation: true,
    emisiones: {
      metodoPrecision: 'por_defecto',
      emisionesKgco2eWtw: 100,
      intensidadGco2ePorTonKm: 50,
    },
  })),
}));

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
      where: vi.fn(() => chain),
      returning: vi.fn(async () => updates.shift() ?? []),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(updates.shift() ?? []));
    };
    return chain;
  };

  const buildInsertChain = () => {
    const chain: Record<string, unknown> = {
      values: vi.fn(() => chain),
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
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    select: tx.select,
    update: tx.update,
    insert: tx.insert,
  };
}

const OFFER_ID = '11111111-1111-1111-1111-111111111111';
const EMPRESA_ID = 'emp-uuid-1';
const USER_ID = 'user-uuid-1';
const TRIP_ID = 'trip-uuid-1';

const VALID_OFFER = {
  id: OFFER_ID,
  tripId: TRIP_ID,
  empresaId: EMPRESA_ID,
  status: 'pendiente',
  proposedPriceClp: 250000,
  suggestedVehicleId: 'veh-uuid-1',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h en futuro
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('acceptOffer', () => {
  it('throw OfferNotFoundError si offer no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(OfferNotFoundError);
  });

  it('throw OfferNotOwnedError si offer.empresaId no coincide', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, empresaId: 'OTRA-empresa' }]],
    });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(OfferNotOwnedError);
  });

  it('throw OfferNotPendingError si offer ya no está pendiente', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, status: 'aceptada' }]],
    });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(OfferNotPendingError);
  });

  it('throw OfferExpiredError si expiresAt en el pasado', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, expiresAt: new Date(Date.now() - 1000) }]],
    });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(OfferExpiredError);
  });

  it('happy path: accept con 0 supersededOffers + assignment creado', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [
        [{ ...VALID_OFFER, status: 'aceptada' }], // UPDATE offer
        [], // UPDATE supersededed (vacío, era la única)
        [], // UPDATE trip status
      ],
      inserts: [
        [{ id: 'assign-1', tripId: TRIP_ID, vehicleId: 'veh-uuid-1', agreedPriceClp: 250000 }], // INSERT assignment
        [], // INSERT events
      ],
    });
    const result = await acceptOffer({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      userId: USER_ID,
    });
    expect(result.assignment.id).toBe('assign-1');
    expect(result.supersededOfferIds).toEqual([]);
  });

  it('happy path: accept con N supersededOffers (otras offers pendientes del mismo trip)', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [
        [{ ...VALID_OFFER, status: 'aceptada' }],
        [{ id: 'o2' }, { id: 'o3' }, { id: 'o4' }], // 3 supersededOffers
        [],
      ],
      inserts: [[{ id: 'assign-1', tripId: TRIP_ID, vehicleId: 'veh-uuid-1' }], []],
    });
    const result = await acceptOffer({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      userId: USER_ID,
    });
    expect(result.supersededOfferIds).toEqual(['o2', 'o3', 'o4']);
  });

  it('UPDATE offer retorna empty → throw "Update offer returned no row"', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [[]], // UPDATE retorna vacío
    });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/Update offer returned no row/);
  });

  it('INSERT assignment retorna empty → throw', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [[{ ...VALID_OFFER, status: 'aceptada' }]],
      inserts: [[]], // INSERT assignment vacío
    });
    await expect(
      acceptOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
      }),
    ).rejects.toThrow(/Insert assignment returned no row/);
  });

  it('suggestedVehicleId null → assignment.vehicleId queda como string vacío', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, suggestedVehicleId: null }]],
      updates: [[{ ...VALID_OFFER, status: 'aceptada' }], [], []],
      inserts: [[{ id: 'assign-1', tripId: TRIP_ID, vehicleId: '' }], []],
    });
    const result = await acceptOffer({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      userId: USER_ID,
    });
    expect(result.assignment.id).toBe('assign-1');
  });
});

describe('rejectOffer', () => {
  it('throw OfferNotFoundError si offer no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      rejectOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
        reason: undefined,
      }),
    ).rejects.toThrow(OfferNotFoundError);
  });

  it('throw OfferNotOwnedError si empresaId no coincide', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, empresaId: 'OTRA' }]],
    });
    await expect(
      rejectOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
        reason: 'no me sirve',
      }),
    ).rejects.toThrow(OfferNotOwnedError);
  });

  it('throw OfferNotPendingError si offer ya no es pendiente', async () => {
    const db = makeDb({
      selects: [[{ ...VALID_OFFER, status: 'rechazada' }]],
    });
    await expect(
      rejectOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
        reason: undefined,
      }),
    ).rejects.toThrow(OfferNotPendingError);
  });

  it('happy path con reason: marca rechazada con rejectionReason', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [[{ ...VALID_OFFER, status: 'rechazada', rejectionReason: 'fuera de zona' }]],
      inserts: [[]],
    });
    const result = await rejectOffer({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      userId: USER_ID,
      reason: 'fuera de zona',
    });
    expect(result.status).toBe('rechazada');
  });

  it('happy path SIN reason: marca rechazada sin rejectionReason', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [[{ ...VALID_OFFER, status: 'rechazada' }]],
      inserts: [[]],
    });
    const result = await rejectOffer({
      db: db as never,
      logger: noopLogger,
      offerId: OFFER_ID,
      empresaId: EMPRESA_ID,
      userId: USER_ID,
      reason: undefined,
    });
    expect(result.status).toBe('rechazada');
  });

  it('UPDATE retorna empty → throw "Update offer returned no row"', async () => {
    const db = makeDb({
      selects: [[VALID_OFFER]],
      updates: [[]],
    });
    await expect(
      rejectOffer({
        db: db as never,
        logger: noopLogger,
        offerId: OFFER_ID,
        empresaId: EMPRESA_ID,
        userId: USER_ID,
        reason: undefined,
      }),
    ).rejects.toThrow(/Update offer returned no row/);
  });
});
