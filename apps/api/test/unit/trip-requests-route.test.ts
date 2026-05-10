import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

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
  inserts?: unknown[][] | Array<{ throw: unknown }>;
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const inserts = [...(queues.inserts ?? [])] as Array<unknown[] | { throw: unknown }>;

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => {
        const next = inserts.shift();
        if (next && typeof next === 'object' && 'throw' in next) {
          throw next.throw;
        }
        return (next as unknown[] | undefined) ?? [];
      }),
    })),
  });

  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
  };
}

async function buildApp(db: unknown) {
  const { createTripRequestsRoutes } = await import('../../src/routes/trip-requests.js');
  const app = new Hono();
  app.route('/trip-requests', createTripRequestsRoutes({ db: db as never, logger: noopLogger }));
  return app;
}

const VALID_BODY = {
  shipper_whatsapp: '+56912345678',
  origin_address_raw: 'Av. X 100, Stgo',
  destination_address_raw: 'Pto Vpo',
  cargo_type: 'carga_seca',
  pickup_date_raw: 'mañana',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /trip-requests', () => {
  it('body inválido (zod) → 400', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: 201 con tracking_code + id', async () => {
    const db = makeDb({
      inserts: [
        [
          {
            id: 'draft-uuid',
            trackingCode: 'BOO-ABC123',
            cargoType: 'carga_seca',
            status: 'capturado',
            createdAt: new Date('2026-05-10T12:00:00Z'),
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { tracking_code: string; id: string };
    expect(body.tracking_code).toBe('BOO-ABC123');
  });

  it('colisión tracking_code (23505) → reintenta y eventualmente succeeds', async () => {
    const collision = { code: '23505' };
    const db = makeDb({
      inserts: [
        { throw: collision },
        { throw: collision },
        [
          {
            id: 'd2',
            trackingCode: 'BOO-XYZ789',
            cargoType: 'carga_seca',
            status: 'capturado',
            createdAt: new Date(),
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(201);
    expect(noopLogger.warn).toHaveBeenCalledTimes(2);
  });

  it('5 colisiones consecutivas → 503 tracking_code_collision', async () => {
    const collision = { code: '23505' };
    const db = makeDb({
      inserts: [
        { throw: collision },
        { throw: collision },
        { throw: collision },
        { throw: collision },
        { throw: collision },
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(503);
  });

  it('error no-colisión → 500 internal_server_error', async () => {
    const db = makeDb({
      inserts: [{ throw: new Error('connection lost') }],
    });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(500);
  });

  it('INSERT retorna empty → 500 internal_server_error', async () => {
    const db = makeDb({ inserts: [[]] });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(res.status).toBe(500);
  });
});

describe('GET /trip-requests/:code', () => {
  it('formato inválido → 400 invalid_tracking_code_format', async () => {
    const db = makeDb();
    const app = await buildApp(db);
    const res = await app.request('/trip-requests/no-tiene-formato');
    expect(res.status).toBe(400);
  });

  it('código válido pero no existe → 404', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests/BOO-ABC123');
    expect(res.status).toBe(404);
  });

  it('happy path: retorna draft completo', async () => {
    const db = makeDb({
      selects: [
        [
          {
            id: 'd-uuid',
            trackingCode: 'BOO-ABC123',
            cargoType: 'carga_seca',
            originAddressRaw: 'Av. X 100',
            destinationAddressRaw: 'Pto Vpo',
            pickupDateRaw: 'mañana',
            status: 'capturado',
            createdAt: new Date('2026-05-10T12:00:00Z'),
            updatedAt: new Date('2026-05-10T12:00:00Z'),
          },
        ],
      ],
    });
    const app = await buildApp(db);
    const res = await app.request('/trip-requests/BOO-ABC123');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tracking_code: string; status: string };
    expect(body.tracking_code).toBe('BOO-ABC123');
    expect(body.status).toBe('capturado');
  });
});
