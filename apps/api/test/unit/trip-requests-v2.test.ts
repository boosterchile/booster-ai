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

vi.mock('../../src/services/matching.js', () => {
  return {
    runMatching: vi.fn(),
    TripRequestNotFoundError: class TripRequestNotFoundError extends Error {
      constructor(public readonly tripId: string) {
        super(`Trip ${tripId} not found`);
        this.name = 'TripRequestNotFoundError';
      }
    },
    TripRequestNotMatchableError: class TripRequestNotMatchableError extends Error {
      constructor(
        public readonly tripId: string,
        public readonly status: string,
      ) {
        super(`Trip ${tripId} in status ${status}`);
        this.name = 'TripRequestNotMatchableError';
      }
    },
  };
});

const noop = (): undefined => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/trip-requests-v2.js').createTripRequestsV2Routes
>[0]['logger'];

function makeStubDb(insertedRow: Record<string, unknown>): Db {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [insertedRow]),
      })),
    })),
  } as unknown as Db;
}

/**
 * Construye un body válido con fechas relativas a `now()` para que los
 * tests no se invaliden con el paso del tiempo. La regla del schema exige
 * `pickup_window.start_at >= now + 30min`; usamos `now + 24h` con holgura
 * y `end_at = start_at + 10h` para una ventana razonable.
 */
function makeValidBody(overrides?: { startOffsetMs?: number; endOffsetMs?: number }) {
  const now = Date.now();
  const startMs = now + (overrides?.startOffsetMs ?? 24 * 60 * 60 * 1000);
  const endMs = startMs + (overrides?.endOffsetMs ?? 10 * 60 * 60 * 1000);
  return {
    origin: {
      address_raw: 'Av. Apoquindo 5550',
      region_code: 'XIII',
    },
    destination: {
      address_raw: 'Concepción centro',
      region_code: 'VIII',
    },
    cargo: {
      cargo_type: 'carga_seca',
      weight_kg: 1500,
    },
    pickup_window: {
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
    },
    proposed_price_clp: 250000,
  };
}

const validBody = makeValidBody();

interface UserContextOpts {
  userId?: string;
  empresaId?: string;
  isGeneradorCarga?: boolean;
  empresaStatus?: 'pendiente_verificacion' | 'activa' | 'suspendida';
  withActiveMembership?: boolean;
}

function buildUserContext(opts: UserContextOpts = {}): {
  user: Pick<UserRow, 'id'>;
  memberships: Array<{
    membership: Pick<MembershipRow, 'role'>;
    empresa: Pick<EmpresaRow, 'id' | 'isGeneradorCarga' | 'status'>;
  }>;
  activeMembership: {
    membership: Pick<MembershipRow, 'role'>;
    empresa: Pick<EmpresaRow, 'id' | 'isGeneradorCarga' | 'status'>;
  } | null;
} {
  const empresa = {
    id: opts.empresaId ?? 'emp-1',
    isGeneradorCarga: opts.isGeneradorCarga ?? true,
    status: opts.empresaStatus ?? 'activa',
  };
  const membership = { role: 'dueno' as const };
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

  it('rechaza si no hay userContext con 401', async () => {
    const app = await buildAppWith({ db: makeStubDb({}), userContext: null });
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
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

  it('rechaza si la empresa no es generador de carga con 403 not_a_shipper', async () => {
    const app = await buildAppWith({
      db: makeStubDb({}),
      userContext: buildUserContext({ isGeneradorCarga: false }),
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
      userContext: buildUserContext({ empresaStatus: 'pendiente_verificacion' }),
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

  // ---------------------------------------------------------------------
  // BUG-001 — validación reforzada de pickup_window y direcciones.
  // ---------------------------------------------------------------------
  describe('validación de ventana de pickup y direcciones', () => {
    async function postBody(body: unknown) {
      const app = await buildAppWith({
        db: makeStubDb({}),
        userContext: buildUserContext(),
      });
      return app.request('/trip-requests-v2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    it('rechaza dirección de origen con menos de 5 caracteres', async () => {
      const body = makeValidBody();
      body.origin.address_raw = 'abc'; // 3 caracteres
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza dirección de destino con un solo carácter', async () => {
      const body = makeValidBody();
      body.destination.address_raw = '.';
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza pickup_window.start_at en el pasado', async () => {
      const body = makeValidBody({ startOffsetMs: -24 * 60 * 60 * 1000 }); // ayer
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza pickup_window con start_at sin lead time mínimo (10 min en el futuro)', async () => {
      const body = makeValidBody({ startOffsetMs: 10 * 60 * 1000 });
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza pickup_window con end_at == start_at (ventana de 0 segundos)', async () => {
      const body = makeValidBody();
      body.pickup_window.end_at = body.pickup_window.start_at;
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza pickup_window con end_at < start_at (ventana invertida)', async () => {
      const now = Date.now();
      const startMs = now + 24 * 60 * 60 * 1000; // mañana
      const endMs = startMs - 4 * 60 * 60 * 1000; // 4h antes
      const body = makeValidBody();
      body.pickup_window.start_at = new Date(startMs).toISOString();
      body.pickup_window.end_at = new Date(endMs).toISOString();
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });

    it('rechaza pickup_window con duración mayor a 30 días', async () => {
      const body = makeValidBody({
        startOffsetMs: 24 * 60 * 60 * 1000,
        endOffsetMs: 31 * 24 * 60 * 60 * 1000, // 31 días después de start
      });
      const res = await postBody(body);
      expect(res.status).toBe(400);
    });
  });

  it('happy path: crea trip, dispara matching, devuelve 201', async () => {
    const matching = await import('../../src/services/matching.js');
    vi.mocked(matching.runMatching).mockResolvedValueOnce({
      tripId: 'trip-1',
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
      generadorCargaEmpresaId: 'emp-1',
      cargoType: 'carga_seca',
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
    expect(body.trip_request.status).toBe('ofertas_enviadas');
    expect(body.matching.offers_created).toBe(2);
    expect(body.matching.offer_ids).toEqual(['offer-1', 'offer-2']);
  });

  it('matching sin candidatos: 201 con status=expirado y matching offers vacío', async () => {
    const matching = await import('../../src/services/matching.js');
    vi.mocked(matching.runMatching).mockResolvedValueOnce({
      tripId: 'trip-2',
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
    expect(body.trip_request.status).toBe('expirado');
    expect(body.matching.offers_created).toBe(0);
  });

  it('matching throws: 201 con status=esperando_match y matching=null', async () => {
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
    expect(body.trip_request.status).toBe('esperando_match');
    expect(body.matching).toBeNull();
  });
});

// =============================================================================
// GET /trip-requests-v2 (list)
// =============================================================================

/**
 * Stub para el flow de SELECT/INSERT/UPDATE.
 * GET / chain: db.select().from().where().orderBy()
 * GET /:id chain: db.select().from().where().limit() (multiples joins)
 * PATCH cancelar: db.select().from().where().limit() + db.update().set().where().returning() + db.insert().values()
 */
function makeQueryDb(opts: {
  // Orden de respuestas a `orderBy()` en GET / o GET /:id (events list)
  orderByRows?: Array<Record<string, unknown>[]>;
  // Orden de respuestas a `limit()` (varios reads en GET /:id, PATCH cancel)
  limitRows?: Array<Record<string, unknown>[]>;
  // Respuesta de `update().set().where().returning()`
  updateRows?: Record<string, unknown>[];
  // Spy del .insert
  insertSpy?: ReturnType<typeof vi.fn>;
}): Db {
  let orderByCallCount = 0;
  let limitCallCount = 0;

  const limitFn = vi.fn(() => {
    const idx = limitCallCount;
    limitCallCount += 1;
    return Promise.resolve(opts.limitRows?.[idx] ?? []);
  });
  // orderBy es thenable + chainable: soporta tanto `await db…orderBy(...)`
  // (devuelve los rows orderByRows[idx]) como `await db…orderBy(...).limit(N)`
  // (encadena a limitFn que consume limitRows[idx]).
  const orderByFn = vi.fn(() => {
    const idx = orderByCallCount;
    orderByCallCount += 1;
    const rows = opts.orderByRows?.[idx] ?? [];
    return {
      then: (
        resolve: (v: Record<string, unknown>[]) => unknown,
        reject?: (err: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
      limit: limitFn,
    };
  });
  const leftJoinFn = vi.fn(() => ({
    leftJoin: leftJoinFn,
    where: vi.fn(() => ({ limit: limitFn, orderBy: orderByFn })),
  }));
  const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
  const fromFn = vi.fn(() => ({
    where: whereFn,
    leftJoin: leftJoinFn,
  }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const updateReturning = vi.fn().mockResolvedValue(opts.updateRows ?? []);
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const updateFn = vi.fn(() => ({ set: updateSet }));

  const insertFn = opts.insertSpy ?? vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) }));

  return {
    select: selectFn,
    update: updateFn,
    insert: insertFn,
  } as unknown as Db;
}

describe('GET /trip-requests-v2', () => {
  it('sin userContext → 401', async () => {
    const app = await buildAppWith({ db: makeQueryDb({}), userContext: null });
    const res = await app.request('/trip-requests-v2');
    expect(res.status).toBe(401);
  });

  it('sin activeMembership → 403', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({}),
      userContext: buildUserContext({ withActiveMembership: false }),
    });
    const res = await app.request('/trip-requests-v2');
    expect(res.status).toBe(403);
  });

  it('empresa no es generador de carga → 403', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({}),
      userContext: buildUserContext({ isGeneradorCarga: false }),
    });
    const res = await app.request('/trip-requests-v2');
    expect(res.status).toBe(403);
  });

  it('200 con array de trips de la empresa activa', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({
        orderByRows: [
          [
            {
              id: 'trip-1',
              tracking_code: 'BOO-AAA111',
              status: 'esperando_match',
              origin_address_raw: 'Av. Apoquindo 5550',
              origin_region_code: 'XIII',
              destination_address_raw: 'Concepción centro',
              destination_region_code: 'VIII',
              cargo_type: 'carga_seca',
              cargo_weight_kg: 1500,
              cargo_volume_m3: null,
              pickup_window_start: new Date('2026-05-05T08:00:00Z'),
              pickup_window_end: new Date('2026-05-05T18:00:00Z'),
              proposed_price_clp: 250_000,
              created_at: new Date('2026-05-02T15:00:00Z'),
            },
          ],
        ],
      }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trip_requests: Array<{ id: string; status: string }> };
    expect(body.trip_requests).toHaveLength(1);
    expect(body.trip_requests[0]?.id).toBe('trip-1');
    expect(body.trip_requests[0]?.status).toBe('esperando_match');
  });
});

// =============================================================================
// GET /trip-requests-v2/:id (detail)
// =============================================================================

describe('GET /trip-requests-v2/:id', () => {
  it('sin userContext → 401', async () => {
    const app = await buildAppWith({ db: makeQueryDb({}), userContext: null });
    const res = await app.request('/trip-requests-v2/trip-1');
    expect(res.status).toBe(401);
  });

  it('trip no encontrado o de otra empresa → 404', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({ limitRows: [[]] }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2/trip-1');
    expect(res.status).toBe(404);
  });

  it('200 con trip + events + assignment + metrics', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({
        // limitRows orden: trip lookup, assignment, metrics
        limitRows: [
          [
            {
              id: 'trip-1',
              trackingCode: 'BOO-AAA111',
              status: 'asignado',
              originAddressRaw: 'origen',
              originRegionCode: 'XIII',
              originComunaCode: null,
              destinationAddressRaw: 'destino',
              destinationRegionCode: 'VIII',
              destinationComunaCode: null,
              cargoType: 'carga_seca',
              cargoWeightKg: 1500,
              cargoVolumeM3: null,
              cargoDescription: null,
              pickupWindowStart: new Date('2026-05-05T08:00:00Z'),
              pickupWindowEnd: new Date('2026-05-05T18:00:00Z'),
              proposedPriceClp: 250_000,
              createdAt: new Date('2026-05-02T15:00:00Z'),
              updatedAt: new Date('2026-05-02T15:00:00Z'),
            },
          ],
          [
            {
              id: 'asg-1',
              status: 'asignado',
              agreed_price_clp: 240_000,
              empresa_id: 'carrier-1',
              empresa_legal_name: 'Transportes Acme',
              vehicle_id: 'veh-1',
              vehicle_plate: 'AB-CD-12',
              vehicle_type: 'camion_pequeno',
              driver_user_id: null,
              driver_name: null,
            },
          ],
          [], // no metrics
          // 4to limit: telemetry last point (where + orderBy + limit). Vacío
          // → ubicacion_actual será null en la respuesta.
          [],
        ],
        orderByRows: [[]], // events list empty
      }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2/trip-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trip_request: { id: string; status: string };
      events: unknown[];
      assignment: { vehicle_plate: string; empresa_legal_name: string } | null;
      metrics: unknown | null;
    };
    expect(body.trip_request.id).toBe('trip-1');
    expect(body.assignment?.vehicle_plate).toBe('AB-CD-12');
    expect(body.assignment?.empresa_legal_name).toBe('Transportes Acme');
    expect(body.metrics).toBeNull();
  });
});

// =============================================================================
// PATCH /trip-requests-v2/:id/cancelar
// =============================================================================

describe('PATCH /trip-requests-v2/:id/cancelar', () => {
  it('sin userContext → 401', async () => {
    const app = await buildAppWith({ db: makeQueryDb({}), userContext: null });
    const res = await app.request('/trip-requests-v2/trip-1/cancelar', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('trip no encontrado → 404', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({ limitRows: [[]] }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2/trip-1/cancelar', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('trip ya asignado → 409 trip_not_cancellable', async () => {
    const app = await buildAppWith({
      db: makeQueryDb({
        limitRows: [[{ id: 'trip-1', status: 'asignado', trackingCode: 'BOO-XXX' }]],
      }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2/trip-1/cancelar', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; current_status: string };
    expect(body.code).toBe('trip_not_cancellable');
    expect(body.current_status).toBe('asignado');
  });

  it('200 cancela en estado esperando_match + registra evento', async () => {
    const insertValues = vi.fn().mockResolvedValue([]);
    const insertSpy = vi.fn(() => ({ values: insertValues }));
    const app = await buildAppWith({
      db: makeQueryDb({
        limitRows: [[{ id: 'trip-1', status: 'esperando_match', trackingCode: 'BOO-YYY' }]],
        updateRows: [{ id: 'trip-1', trackingCode: 'BOO-YYY', status: 'cancelado' }],
        insertSpy,
      }),
      userContext: buildUserContext(),
    });
    const res = await app.request('/trip-requests-v2/trip-1/cancelar', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'cambio de planes' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trip_request: { status: string } };
    expect(body.trip_request.status).toBe('cancelado');
    expect(insertSpy).toHaveBeenCalled();
  });
});
