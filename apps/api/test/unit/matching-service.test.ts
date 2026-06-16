import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vehicles } from '../../src/db/schema.js';
import {
  TripRequestNotFoundError,
  TripRequestNotMatchableError,
  runMatching,
} from '../../src/services/matching.js';

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

/**
 * Mock Drizzle DB que soporta cadenas fluent thenable y db.transaction(cb).
 * Cada chain de SELECT consume el siguiente item de selects[].
 */
function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];
  const inserts = [...(queues.inserts ?? [])];

  // Trazas para aserciones de forma de acceso a DB (N+1, orden determinista).
  const fromCalls: unknown[] = [];
  const orderByCalls: unknown[][] = [];
  const insertValues: unknown[] = [];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn((table?: unknown) => {
        fromCalls.push(table);
        return chain;
      }),
      where: vi.fn(() => chain),
      orderBy: vi.fn((...cols: unknown[]) => {
        orderByCalls.push(cols);
        return chain;
      }),
      innerJoin: vi.fn(() => chain),
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
      // CAS de estado (ADR-061): default fila-presente para happy paths;
      // un test puede encolar [] en `updates` para simular el cancel
      // concurrente (0 filas → TripRequestNotMatchableError).
      returning: vi.fn(async () => updates.shift() ?? [{ id: 'cas-ok' }]),
    };
    chain.then = (resolve: (v: unknown) => unknown) => {
      return Promise.resolve(resolve(updates.shift() ?? [{ id: 'cas-ok' }]));
    };
    return chain;
  };

  const buildInsertChain = () => {
    const chain: Record<string, unknown> = {
      values: vi.fn((rows?: unknown) => {
        insertValues.push(rows);
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
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    select: tx.select,
    update: tx.update,
    insert: tx.insert,
    __fromCalls: fromCalls,
    __orderByCalls: orderByCalls,
    __insertValues: insertValues,
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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('runMatching', () => {
  it('throw TripRequestNotFoundError si trip no existe', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID }),
    ).rejects.toThrow(TripRequestNotFoundError);
  });

  it('throw TripRequestNotMatchableError si status != esperando_match', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, status: 'ofertas_enviadas' }]],
    });
    await expect(
      runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID }),
    ).rejects.toThrow(TripRequestNotMatchableError);
  });

  it('CAS 0 filas en →emparejando (cancel concurrente) → TripRequestNotMatchableError (SC-4)', async () => {
    // El SELECT ve esperando_match, pero entre el SELECT y el UPDATE un
    // cancel concurrente ganó: el CAS (WHERE status='esperando_match')
    // retorna 0 filas y la tx aborta — antes, el matching pisaba el
    // 'cancelado' y resucitaba el trip (residual review #436).
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, status: 'esperando_match' }]],
      updates: [[]], // CAS → 0 filas
    });
    await expect(
      runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID }),
    ).rejects.toThrow(TripRequestNotMatchableError);
  });

  it('throw TripRequestNotMatchableError si trip no tiene originRegionCode', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_BASE, originRegionCode: null }]],
    });
    await expect(
      runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID }),
    ).rejects.toThrow(TripRequestNotMatchableError);
  });

  it('no_carrier_in_origin_region: 0 zonas → trip a expirado, retorna 0 offers', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE], // load trip
        [], // zones (vacío)
      ],
      inserts: [[], []], // matching_iniciado + oferta_expirada
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.candidatesEvaluated).toBe(0);
    expect(result.offersCreated).toBe(0);
    expect(result.offers).toEqual([]);
  });

  it('no_active_carriers: zonas existen pero ninguna empresa activa → expirado', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }, { empresaId: 'emp-2' }], // zonas
        [], // empresas activas (vacío)
      ],
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

  it('no_vehicle_with_capacity: empresas activas pero sin vehículo apto → expirado', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }],
        [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
        [], // vehicles para emp-1: vacío
      ],
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

  it('happy path 1 candidato: crea 1 offer, trip a ofertas_enviadas', async () => {
    const offer = {
      id: 'offer-1',
      tripId: TRIP_ID,
      empresaId: 'emp-1',
      suggestedVehicleId: 'veh-1',
      score: 950,
      status: 'pendiente',
      proposedPriceClp: 250000,
    };
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }],
        [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
        [{ id: 'veh-1', empresaId: 'emp-1', capacityKg: 5500, vehicleStatus: 'activo' }],
      ],
      inserts: [
        [], // matching_iniciado event
        [offer], // INSERT offers returning
        [], // ofertas_enviadas event
      ],
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.candidatesEvaluated).toBe(1);
    expect(result.offersCreated).toBe(1);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.id).toBe('offer-1');
  });

  it('happy path multi-candidato: top-N respeta cantidades', async () => {
    const offers = [
      { id: 'o1', empresaId: 'emp-1' },
      { id: 'o2', empresaId: 'emp-2' },
      { id: 'o3', empresaId: 'emp-3' },
    ];
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }, { empresaId: 'emp-2' }, { empresaId: 'emp-3' }],
        [
          { id: 'emp-1', isTransportista: true, status: 'activa' },
          { id: 'emp-2', isTransportista: true, status: 'activa' },
          { id: 'emp-3', isTransportista: true, status: 'activa' },
        ],
        // Una sola query batch de vehículos para las 3 empresas (post N+1 fix).
        [
          { id: 'v1', empresaId: 'emp-1', capacityKg: 5200 },
          { id: 'v2', empresaId: 'emp-2', capacityKg: 5800 },
          { id: 'v3', empresaId: 'emp-3', capacityKg: 12000 },
        ],
      ],
      inserts: [[], offers, []],
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.candidatesEvaluated).toBe(3);
    expect(result.offersCreated).toBe(3);
  });

  it('N+1 fix: consulta la tabla vehicles UNA sola vez para N empresas candidatas', async () => {
    const offerRows = [
      { id: 'o1', empresaId: 'emp-1' },
      { id: 'o2', empresaId: 'emp-2' },
    ];
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }, { empresaId: 'emp-2' }], // zonas
        [
          { id: 'emp-1', isTransportista: true, status: 'activa' },
          { id: 'emp-2', isTransportista: true, status: 'activa' },
        ],
        // Batch único: ambos vehículos en una sola respuesta.
        [
          { id: 'v1', empresaId: 'emp-1', capacityKg: 5200 },
          { id: 'v2', empresaId: 'emp-2', capacityKg: 5800 },
        ],
      ],
      inserts: [[], offerRows, []],
    });
    const result = await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

    // Ambas empresas reciben oferta: el batch agrupa por empresa correctamente.
    expect(result.candidatesEvaluated).toBe(2);
    expect(result.offersCreated).toBe(2);

    // El corazón del fix: la tabla vehicles se consulta EXACTAMENTE una vez,
    // no una por empresa candidata (antes: N queries).
    const vehicleQueries = (db.__fromCalls as unknown[]).filter((t) => t === vehicles);
    expect(vehicleQueries).toHaveLength(1);

    // Determinismo (skill empty-leg-matching §7): el batch ordena por
    // (capacityKg, id) para que el best-fit sea estable ante empates.
    const vehicleOrderBy = (db.__orderByCalls as unknown[][]).find(
      (cols) => cols.includes(vehicles.capacityKg) && cols.includes(vehicles.id),
    );
    expect(vehicleOrderBy).toBeDefined();
  });

  it('best-fit por empresa: con 2 vehículos aptos elige el primero del orden SQL (menor capacidad)', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        [{ empresaId: 'emp-1' }],
        [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
        // El orden lo garantiza el orderBy(capacityKg, id) en SQL; el mock
        // lo respeta entregando el menor primero. El grouping toma el primero.
        [
          { id: 'veh-small', empresaId: 'emp-1', capacityKg: 5200 },
          { id: 'veh-big', empresaId: 'emp-1', capacityKg: 9000 },
        ],
      ],
      inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
    });
    await runMatching({ db: db as never, logger: noopLogger, tripId: TRIP_ID });

    // La offer insertada sugiere el vehículo best-fit (menor capacidad apta).
    const offerInsert = (db.__insertValues as unknown[]).find(
      (rows): rows is Array<{ suggestedVehicleId?: string }> =>
        Array.isArray(rows) && rows.length > 0 && 'suggestedVehicleId' in (rows[0] ?? {}),
    );
    expect(offerInsert?.[0]?.suggestedVehicleId).toBe('veh-small');
  });

  it('cargo_weight null → trata como 0, sigue matching', async () => {
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, cargoWeightKg: null }],
        [{ empresaId: 'emp-1' }],
        [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
        [{ id: 'v1', empresaId: 'emp-1', capacityKg: 1000 }],
      ],
      inserts: [[], [{ id: 'o1', empresaId: 'emp-1' }], []],
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.offersCreated).toBe(1);
  });

  it('proposedPriceClp null → propaga como 0 a las offers', async () => {
    const db = makeDb({
      selects: [
        [{ ...TRIP_BASE, proposedPriceClp: null }],
        [{ empresaId: 'emp-1' }],
        [{ id: 'emp-1', isTransportista: true, status: 'activa' }],
        [{ id: 'v1', empresaId: 'emp-1', capacityKg: 6000 }],
      ],
      inserts: [[], [{ id: 'o1', empresaId: 'emp-1', proposedPriceClp: 0 }], []],
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.offersCreated).toBe(1);
  });

  it('candidateZones con duplicados → dedup empresaIds', async () => {
    const db = makeDb({
      selects: [
        [TRIP_BASE],
        // 2 zonas para emp-1, 1 para emp-2 → dedup a [emp-1, emp-2]
        [{ empresaId: 'emp-1' }, { empresaId: 'emp-1' }, { empresaId: 'emp-2' }],
        [
          { id: 'emp-1', isTransportista: true, status: 'activa' },
          { id: 'emp-2', isTransportista: true, status: 'activa' },
        ],
        // Batch único de vehículos para ambas empresas (post N+1 fix).
        [
          { id: 'v1', empresaId: 'emp-1', capacityKg: 6000 },
          { id: 'v2', empresaId: 'emp-2', capacityKg: 7000 },
        ],
      ],
      inserts: [
        [],
        [
          { id: 'o1', empresaId: 'emp-1' },
          { id: 'o2', empresaId: 'emp-2' },
        ],
        [],
      ],
    });
    const result = await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
    });
    expect(result.candidatesEvaluated).toBe(2);
  });

  it('notify provided + 0 offers (no candidates) → no se invoca notifier', async () => {
    const notifierFn = vi.fn(async () => undefined);
    const notify = {
      db: {} as never,
      logger: noopLogger,
      whatsAppClient: { sendOfferNotification: notifierFn } as never,
    };
    const db = makeDb({
      selects: [[TRIP_BASE], []],
      inserts: [[], []],
    });
    await runMatching({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      notify: notify as never,
    });
    expect(notifierFn).not.toHaveBeenCalled();
  });
});
