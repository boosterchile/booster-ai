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

vi.mock('../../src/services/offer-actions.js', () => {
  return {
    acceptOffer: vi.fn(),
    rejectOffer: vi.fn(),
    OfferNotFoundError: class extends Error {
      constructor(public readonly offerId: string) {
        super(`Offer ${offerId} not found`);
        this.name = 'OfferNotFoundError';
      }
    },
    OfferNotOwnedError: class extends Error {
      constructor(
        public readonly offerId: string,
        public readonly empresaId: string,
      ) {
        super(`Offer ${offerId} not owned by ${empresaId}`);
        this.name = 'OfferNotOwnedError';
      }
    },
    OfferNotPendingError: class extends Error {
      constructor(
        public readonly offerId: string,
        public readonly status: string,
      ) {
        super(`Offer ${offerId} status=${status}`);
        this.name = 'OfferNotPendingError';
      }
    },
    OfferExpiredError: class extends Error {
      constructor(public readonly offerId: string) {
        super(`Offer ${offerId} expired`);
        this.name = 'OfferExpiredError';
      }
    },
  };
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/offers.js').createOfferRoutes
>[0]['logger'];

interface UserContextOpts {
  isTransportista?: boolean;
  empresaId?: string;
  withActiveMembership?: boolean;
}
function buildUserContext(opts: UserContextOpts = {}) {
  const empresa = {
    id: opts.empresaId ?? 'emp-carrier-1',
    isTransportista: opts.isTransportista ?? true,
    isGeneradorCarga: false,
    status: 'activa',
  };
  return {
    user: { id: 'user-1' } as Pick<UserRow, 'id'>,
    memberships: [
      {
        membership: { role: 'dueno' } as Pick<MembershipRow, 'role'>,
        empresa: empresa as Pick<
          EmpresaRow,
          'id' | 'isTransportista' | 'isGeneradorCarga' | 'status'
        >,
      },
    ],
    activeMembership:
      opts.withActiveMembership === false
        ? null
        : {
            membership: { role: 'dueno' } as Pick<MembershipRow, 'role'>,
            empresa: empresa as Pick<
              EmpresaRow,
              'id' | 'isTransportista' | 'isGeneradorCarga' | 'status'
            >,
          },
  };
}

function makeStubDbForList(rows: unknown[]): Db {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(async () => rows),
          })),
        })),
      })),
    })),
  } as unknown as Db;
}

async function buildAppWith(opts: {
  db: Db;
  userContext: ReturnType<typeof buildUserContext> | null;
}) {
  const { createOfferRoutes } = await import('../../src/routes/offers.js');
  const app = new Hono();
  app.use('/offers/*', async (c, next) => {
    if (opts.userContext) {
      c.set('userContext', opts.userContext as unknown as Parameters<typeof c.set>[1]);
    }
    await next();
  });
  app.route('/offers', createOfferRoutes({ db: opts.db, logger: noopLogger }));
  return app;
}

describe('GET /offers/mine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('500 si no hay userContext', async () => {
    const app = await buildAppWith({ db: makeStubDbForList([]), userContext: null });
    const res = await app.request('/offers/mine');
    expect(res.status).toBe(500);
  });

  it('403 si activeMembership es null', async () => {
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext({ withActiveMembership: false }),
    });
    const res = await app.request('/offers/mine');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'no_active_empresa',
      code: 'no_active_empresa',
    });
  });

  it('403 si la empresa no es transportista', async () => {
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext({ isTransportista: false }),
    });
    const res = await app.request('/offers/mine');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_a_carrier', code: 'not_a_carrier' });
  });

  it('200 con lista vacía', async () => {
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/mine');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offers: [] });
  });

  it('200 con offers shape correcto + score normalizado', async () => {
    const rows = [
      {
        offer: {
          id: 'off-1',
          status: 'pendiente',
          score: 850,
          proposedPriceClp: 100000,
          suggestedVehicleId: 'veh-1',
          sentAt: new Date('2026-04-30T12:00:00Z'),
          expiresAt: new Date('2026-04-30T13:00:00Z'),
          respondedAt: null,
          rejectionReason: null,
        },
        trip: {
          id: 'trip-1',
          trackingCode: 'BOO-AAA111',
          status: 'ofertas_enviadas',
          originAddressRaw: 'Apoquindo 5550',
          originRegionCode: 'XIII',
          destinationAddressRaw: 'Concepción centro',
          destinationRegionCode: 'VIII',
          cargoType: 'carga_seca',
          cargoWeightKg: 1500,
          pickupWindowStart: new Date('2026-05-05T08:00:00Z'),
          pickupWindowEnd: new Date('2026-05-05T18:00:00Z'),
        },
      },
    ];
    const app = await buildAppWith({
      db: makeStubDbForList(rows),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/mine');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ id: string; score: number; trip_request: { tracking_code: string } }>;
    };
    expect(body.offers.length).toBe(1);
    expect(body.offers[0]?.id).toBe('off-1');
    expect(body.offers[0]?.score).toBe(0.85);
    expect(body.offers[0]?.trip_request.tracking_code).toBe('BOO-AAA111');
  });
});

describe('POST /offers/:id/accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path 201 con offer + assignment + supersedes', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockResolvedValueOnce({
      offer: {
        id: 'off-1',
        status: 'aceptada',
        respondedAt: new Date('2026-04-30T12:30:00Z'),
      } as Awaited<ReturnType<typeof actions.acceptOffer>>['offer'],
      assignment: {
        id: 'asg-1',
        tripId: 'trip-1',
        status: 'asignado',
        agreedPriceClp: 100000,
        acceptedAt: new Date('2026-04-30T12:30:00Z'),
        vehicleId: 'veh-1',
      } as Awaited<ReturnType<typeof actions.acceptOffer>>['assignment'],
      supersededOfferIds: ['off-2', 'off-3'],
    });

    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-1/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      offer: { status: string };
      assignment: { id: string; status: string };
      superseded_offer_ids: string[];
    };
    expect(body.offer.status).toBe('aceptada');
    expect(body.assignment.id).toBe('asg-1');
    expect(body.superseded_offer_ids).toEqual(['off-2', 'off-3']);
  });

  it('404 OfferNotFoundError', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockRejectedValueOnce(new actions.OfferNotFoundError('off-x'));
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-x/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('403 OfferNotOwnedError', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockRejectedValueOnce(
      new actions.OfferNotOwnedError('off-y', 'emp-other'),
    );
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-y/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('409 OfferNotPendingError', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockRejectedValueOnce(
      new actions.OfferNotPendingError('off-z', 'rechazada'),
    );
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-z/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });

  it('409 OfferExpiredError', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockRejectedValueOnce(new actions.OfferExpiredError('off-w'));
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-w/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });

  it('409 trip_already_assigned por race condition (UNIQUE)', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.acceptOffer).mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint'),
    );
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-r/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'trip_already_assigned',
      code: 'trip_already_assigned',
    });
  });
});

describe('POST /offers/:id/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('200 con razón', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.rejectOffer).mockResolvedValueOnce({
      id: 'off-1',
      status: 'rechazada',
      respondedAt: new Date(),
      rejectionReason: 'Sin chofer disponible',
    } as Awaited<ReturnType<typeof actions.rejectOffer>>);

    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Sin chofer disponible' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offer: { status: string; rejection_reason: string | null };
    };
    expect(body.offer.status).toBe('rechazada');
    expect(body.offer.rejection_reason).toBe('Sin chofer disponible');
  });

  it('200 sin razón (body vacío válido)', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.rejectOffer).mockResolvedValueOnce({
      id: 'off-2',
      status: 'rechazada',
      respondedAt: new Date(),
      rejectionReason: null,
    } as Awaited<ReturnType<typeof actions.rejectOffer>>);

    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-2/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it('409 OfferNotPendingError', async () => {
    const actions = await import('../../src/services/offer-actions.js');
    vi.mocked(actions.rejectOffer).mockRejectedValueOnce(
      new actions.OfferNotPendingError('off-x', 'aceptada'),
    );
    const app = await buildAppWith({
      db: makeStubDbForList([]),
      userContext: buildUserContext(),
    });
    const res = await app.request('/offers/off-x/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});
