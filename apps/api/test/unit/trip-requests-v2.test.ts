import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import type { EmpresaRow, MembershipRow, UserRow } from '../../src/db/schema.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

// Mock del service de matching — testeamos solo el route layer.
vi.mock('../../src/services/matching.js', () => {
  return {
    runMatching: vi.fn(),
    TripRequestNotFoundError: class TripRequestNotFoundError extends Error {
      constructor(public readonly tripRequestId: string) {
        super(`TripRequest ${tripRequestId} not found`);
        this.name = 'TripRequestNotFoundError';
      }
    },
    TripRequestNotMatchableError: class TripRequestNotMatchableError extends Error {
      constructor(
        public readonly tripRequestId: string,
        public readonly status: string,
      ) {
        super(`TripRequest ${tripRequestId} in status ${status}`);
        this.name = 'TripRequestNotMatchableError';
      }
    },
  };
});

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/trip-requests-v2.js').createTripRequestsV2Routes
>[0]['logger'];

/**
 * Stub del DB con un .insert(...).values(...).returning() chain que devuelve
 * el row pre-armado. El router no hace select, solo insert + delegate al
 * matching service mockeado.
 */
function makeStubDb(insertedRow: Record<string, unknown>): Db {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [insertedRow]),
      })),
    })),
  } as unknown as Db;
}

const validBody = {
  origin: {
    address_raw: 'Av. Apoquindo 5550',
    region_code: 'XIII',
  },
  destination: {
    address_raw: 'Concepción centro',
    region_code: 'VIII',
  },
  cargo: {
    cargo_type: 'dry_goods',
    weight_kg: 1500,
  },
  pickup_window: {
    start_at: '2026-05-05T08:00:00Z',
    end_at: '2026-05-05T18:00:00Z',
  },
  proposed_price_clp: 250000,
};

interface UserContextOpts {
  userId?: string;
  empresaId?: string;
  isShipper?: boolean;
  empresaStatus?: 'pending_verification' | 'active' | 'suspended';
  withActiveMembership?: boolean;
}

function buildUserContext(opts: UserContextOpts = {}): {
  user: Pick<UserRow, 'id'>;
  memberships: Array<{
    membership: Pick<MembershipRow, 'role'>;
    empresa: Pick<EmpresaRow, 'id' | 'isShipper' | 'status'>;
  }>;
  activeMembership: {
    membership: Pick<MembershipRow, 'role'>;
    empresa: Pick<EmpresaRow, 'id' | 'isShipper' | 'status'>;
  } | null;
} {
  const empresa = {
    id: opts.empresaId ?? 'emp-1',
    isShipper: opts.isShipper ?? true,
    status: opts.empresaStatus ?? 'active',
  };
  const membership = { role: 'owner' as const };
  return {
    user: { id: opts.userId ?? 'user-1' },
    memberships: [{ membership, empresa }],
    activeMembership: opts.withActiveMembership === false ? null : { membership, empresa },
  };
}

async function buildAppWith(opts: {
  db: Db;
  userContext: ReturnType<typeof buildUserContext> | null;
}) {
  const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
  const app = new Hono();
  // Simular middleware: setea userContext desde el closure de test.
  app.use('/trip-requests-v2/*', async (c, next) => {
    if (opts.userContext) {
      c.set('userContext', opts.userContext as unknown as Parameters<typeof c.set>[1]);
    }
    await next();
  });
  app.route('/trip-requests-v2', createTripRequestsV2Routes({ db: opts.db, logger: noopLogger }));
  return app;
}

describe('POST /trip-requests-v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza si no hay userContext con 500 (orden middlewares mal)', async () => {
    const app = await buildAppWith({ db: makeStubDb({}), userContext: null });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(500);
  });

  it('rechaza si activeMembership es null con 403 no_active_empresa', async () => {
    const app = await buildAppWith({
      db: makeStubDb({}),
      userContext: buildUserContext({ withActiveMembership: false }),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'no_active_empresa',
      code: 'no_active_empresa',
    });
  });

  it('rechaza si la empresa no es shipper con 403 not_a_shipper', async () => {
    const app = await buildAppWith({
      db: makeStubDb({}),
      userContext: buildUserContext({ isShipper: false }),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_a_shipper', code: 'not_a_shipper' });
  });

  it('rechaza si la empresa no está activa con 403 empresa_not_active', async () => {
    const app = await buildAppWith({
      db: makeStubDb({}),
      userContext: buildUserContext({ empresaStatus: 'pending_verification' }),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'empresa_not_active',
      code: 'empresa_not_active',
    });
  });

  it('rechaza body invalido con 400 (zod)', async () => {
    const app = await buildAppWith({
      db: makeStubDb({}),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: 'incomplete' }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: crea trip_request, dispara matching, devuelve 201', async () => {
    const matching = await import('../../src/services/matching.js');
    vi.mocked(matching.runMatching).mockResolvedValueOnce({
      tripRequestId: 'trip-1',
      candidatesEvaluated: 3,
      offersCreated: 2,
      offers: [
        { id: 'offer-1' } as unknown as Awaited<
          ReturnType<typeof matching.runMatching>
        >['offers'][0],
        { id: 'offer-2' } as unknown as Awaited<
          ReturnType<typeof matching.runMatching>
        >['offers'][0],
      ],
    });

    const insertedTrip = {
      id: 'trip-1',
      trackingCode: 'BOO-ABC123',
      shipperEmpresaId: 'emp-1',
      cargoType: 'dry_goods',
      originRegionCode: 'XIII',
    };
    const app = await buildAppWith({
      db: makeStubDb(insertedTrip),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      trip_request: { id: string; status: string };
      matching: { offers_created: number; offer_ids: string[] };
    };
    expect(body.trip_request.id).toBe('trip-1');
    expect(body.trip_request.status).toBe('offers_sent');
    expect(body.matching.offers_created).toBe(2);
    expect(body.matching.offer_ids).toEqual(['offer-1', 'offer-2']);
  });

  it('matching sin candidatos: 201 con status=expired y matching=null offers', async () => {
    const matching = await import('../../src/services/matching.js');
    vi.mocked(matching.runMatching).mockResolvedValueOnce({
      tripRequestId: 'trip-2',
      candidatesEvaluated: 0,
      offersCreated: 0,
      offers: [],
    });

    const app = await buildAppWith({
      db: makeStubDb({ id: 'trip-2', trackingCode: 'BOO-XYZ789' }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      trip_request: { status: string };
      matching: { offers_created: number };
    };
    expect(body.trip_request.status).toBe('expired');
    expect(body.matching.offers_created).toBe(0);
  });

  it('matching throws: 201 con status=pending_match y matching=null', async () => {
    const matching = await import('../../src/services/matching.js');
    vi.mocked(matching.runMatching).mockRejectedValueOnce(new Error('boom'));

    const app = await buildAppWith({
      db: makeStubDb({ id: 'trip-3', trackingCode: 'BOO-FAIL01' }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { trip_request: { status: string }; matching: null };
    expect(body.trip_request.status).toBe('pending_match');
    expect(body.matching).toBeNull();
  });
});
