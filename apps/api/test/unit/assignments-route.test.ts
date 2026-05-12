import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

// Mock confirmarEntregaViaje porque es la pieza central que ya tenemos
// cubierta por sus propios tests; aquí solo validamos el wiring del route.
vi.mock('../../src/services/confirmar-entrega-viaje.js', () => ({
  confirmarEntregaViaje: vi.fn(),
}));
// Mock asignar-conductor para validar el wire HTTP por separado del
// servicio (que ya tiene su propio test file). Importamos las clases de
// error reales para que el route las pueda detectar via instanceof.
vi.mock('../../src/services/asignar-conductor-a-assignment.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/services/asignar-conductor-a-assignment.js')>();
  return {
    ...actual,
    asignarConductorAAssignment: vi.fn(),
  };
});

const { confirmarEntregaViaje } = await import('../../src/services/confirmar-entrega-viaje.js');
const {
  asignarConductorAAssignment,
  AssignmentNotFoundError,
  AssignmentNotMutableError,
  AssignmentNotOwnedError,
  DriverNotInCarrierError,
} = await import('../../src/services/asignar-conductor-a-assignment.js');

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
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  return { select: vi.fn(() => buildSelectChain()) };
}

const ASSIGNMENT_ID = 'assign-uuid-1';
const TRIP_ID = 'trip-uuid-1';
const CARRIER_EMP = 'carrier-emp';
const USER_ID = 'user-uuid';

const ASSIGNMENT_DETAIL_ROW = {
  assignmentId: ASSIGNMENT_ID,
  assignmentStatus: 'asignado',
  agreedPriceClp: 250000,
  acceptedAt: new Date('2026-05-01T10:00:00Z'),
  pickedUpAt: null,
  deliveredAt: null,
  cancelledAt: null,
  empresaIdAssign: CARRIER_EMP,
  empresaLegalName: 'Carrier SpA',
  vehicleId: 'veh-uuid',
  vehiclePlate: 'AB-CD-12',
  vehicleType: 'camion_pequeno',
  driverUserId: 'driver-uuid',
  driverName: 'Pedro Conductor',
  tripId: TRIP_ID,
  trackingCode: 'TR-1',
  tripStatus: 'asignado',
  originAddressRaw: 'Av. X 100',
  originRegionCode: 'RM',
  destinationAddressRaw: 'Pto Vpo',
  destinationRegionCode: 'V',
  cargoType: 'carga_seca',
  cargoWeightKg: 5000,
  cargoVolumeM3: null,
  pickupWindowStart: new Date('2026-05-01T08:00:00Z'),
  pickupWindowEnd: new Date('2026-05-01T12:00:00Z'),
  proposedPriceClp: 250000,
  shipperLegalName: 'Shipper SpA',
};

async function buildApp(opts: { db: unknown; certConfig?: unknown }) {
  const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
  const app = new Hono();
  app.use('/assignments/*', async (c, next) => {
    const ctxHeader = c.req.header('x-test-userctx');
    if (ctxHeader) {
      c.set('userContext', JSON.parse(ctxHeader));
    }
    await next();
  });
  app.route(
    '/assignments',
    createAssignmentsRoutes({
      db: opts.db as never,
      logger: noopLogger,
      certConfig: opts.certConfig as never,
    }),
  );
  return app;
}

const VALID_CTX = JSON.stringify({
  user: { id: USER_ID },
  activeMembership: {
    empresa: { id: CARRIER_EMP, isTransportista: true, status: 'activa' },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /assignments/:id', () => {
  it('sin userContext → 401 unauthorized', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`);
    expect(res.status).toBe(401);
  });

  it('sin activeMembership → 403 no_active_empresa', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: {
        'x-test-userctx': JSON.stringify({ user: { id: 'u' }, activeMembership: null }),
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'no_active_empresa' }),
    );
  });

  it('empresa no es transportista → 403 not_a_carrier', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: {
        'x-test-userctx': JSON.stringify({
          user: { id: 'u' },
          activeMembership: {
            empresa: { id: 'e', isTransportista: false, status: 'activa' },
          },
        }),
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'not_a_carrier' }),
    );
  });

  it('empresa no activa → 403 empresa_not_active', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: {
        'x-test-userctx': JSON.stringify({
          user: { id: 'u' },
          activeMembership: {
            empresa: { id: 'e', isTransportista: true, status: 'pendiente_verificacion' },
          },
        }),
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'empresa_not_active' }),
    );
  });

  it('assignment no existe → 404', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(404);
  });

  it('assignment de OTRA empresa → 403 forbidden_owner_mismatch', async () => {
    const db = makeDb({
      selects: [[{ ...ASSIGNMENT_DETAIL_ROW, empresaIdAssign: 'OTRA-empresa' }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(403);
  });

  it('happy path: retorna trip_request + assignment + ubicacion_actual null si no hay vehículo', async () => {
    const db = makeDb({
      selects: [[{ ...ASSIGNMENT_DETAIL_ROW, vehicleId: null }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trip_request: { tracking_code: string };
      assignment: { ubicacion_actual: unknown };
    };
    expect(body.trip_request.tracking_code).toBe('TR-1');
    expect(body.assignment.ubicacion_actual).toBeNull();
  });

  it('happy path con telemetría: retorna ubicacion_actual con last point', async () => {
    const db = makeDb({
      selects: [
        [ASSIGNMENT_DETAIL_ROW],
        [
          {
            timestampDevice: new Date('2026-05-10T10:30:00Z'),
            latitude: '-33.45',
            longitude: '-70.65',
            speedKmh: 85,
            angleDeg: 180,
          },
        ],
      ],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}`, {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    const body = (await res.json()) as {
      assignment: { ubicacion_actual: { latitude: number; longitude: number; speed_kmh: number } };
    };
    expect(body.assignment.ubicacion_actual?.latitude).toBeCloseTo(-33.45);
    expect(body.assignment.ubicacion_actual?.speed_kmh).toBe(85);
  });
});

describe('PATCH /assignments/:id/confirmar-entrega', () => {
  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
    });
    expect(res.status).toBe(401);
  });

  it('assignment no existe → 404', async () => {
    const db = makeDb({ selects: [[]] });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(404);
  });

  it('assignment de otra empresa → 403 forbidden_owner_mismatch', async () => {
    const db = makeDb({
      selects: [[{ tripId: TRIP_ID, empresaId: 'OTRA' }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(403);
  });

  it('happy path: confirmarEntregaViaje retorna ok=true → 200 con delivered_at', async () => {
    const deliveredAt = new Date('2026-05-10T15:30:00Z');
    (confirmarEntregaViaje as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      alreadyDelivered: false,
      deliveredAt,
    });
    const db = makeDb({
      selects: [[{ tripId: TRIP_ID, empresaId: CARRIER_EMP }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivered_at: string };
    expect(body.delivered_at).toBe(deliveredAt.toISOString());
  });

  it('service retorna invalid_status → 409 con current_status', async () => {
    (confirmarEntregaViaje as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'invalid_status',
      currentStatus: 'cancelado',
    });
    const db = makeDb({
      selects: [[{ tripId: TRIP_ID, empresaId: CARRIER_EMP }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { current_status: string };
    expect(body.current_status).toBe('cancelado');
  });

  it('service retorna trip_not_found → 404', async () => {
    (confirmarEntregaViaje as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'trip_not_found',
    });
    const db = makeDb({
      selects: [[{ tripId: TRIP_ID, empresaId: CARRIER_EMP }]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-entrega`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /assignments/:id/asignar-conductor', () => {
  const VALID_BODY = { driver_user_id: '00000000-0000-0000-0000-000000000a05' };

  // El test header VALID_CTX no incluía 'membership' (subobjeto), pero
  // el endpoint nuevo lee `auth.activeMembership.membership.role`. Para
  // estos tests usamos un contexto extendido con rol explícito.
  const CTX_DUENO = JSON.stringify({
    user: { id: USER_ID },
    activeMembership: {
      empresa: { id: CARRIER_EMP, isTransportista: true, status: 'activa' },
      membership: { role: 'dueno' },
    },
  });

  function makeReq(body: unknown = VALID_BODY, headers: Record<string, string> = {}) {
    return {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    };
  }

  it('sin auth → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/asignar-conductor`, makeReq());
    expect(res.status).toBe(401);
  });

  it('rol no permitido (operador) → 403 forbidden_role', async () => {
    const app = await buildApp({ db: makeDb() });
    const ctx = JSON.stringify({
      user: { id: USER_ID },
      activeMembership: {
        empresa: { id: CARRIER_EMP, isTransportista: true, status: 'activa' },
        membership: { role: 'operador' },
      },
    });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': ctx }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'forbidden_role' }),
    );
  });

  it('body inválido (driver_user_id no es UUID) → 400', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq({ driver_user_id: 'not-a-uuid' }, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(400);
  });

  it('happy path: rol dueno → 200 + payload', async () => {
    (asignarConductorAAssignment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      assignmentId: ASSIGNMENT_ID,
      previousDriverUserId: null,
      newDriverUserId: VALID_BODY.driver_user_id,
      driverName: 'Pedro González',
    });
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; driver_name: string };
    expect(body.ok).toBe(true);
    expect(body.driver_name).toBe('Pedro González');
  });

  it('service AssignmentNotFoundError → 404', async () => {
    (asignarConductorAAssignment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AssignmentNotFoundError(ASSIGNMENT_ID),
    );
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(404);
  });

  it('service AssignmentNotOwnedError → 403', async () => {
    (asignarConductorAAssignment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AssignmentNotOwnedError(ASSIGNMENT_ID, 'otra'),
    );
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(403);
  });

  it('service AssignmentNotMutableError → 409 con status incluido', async () => {
    (asignarConductorAAssignment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AssignmentNotMutableError(ASSIGNMENT_ID, 'entregado'),
    );
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; status: string };
    expect(body.code).toBe('assignment_not_mutable');
    expect(body.status).toBe('entregado');
  });

  it('service DriverNotInCarrierError → 400', async () => {
    (asignarConductorAAssignment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DriverNotInCarrierError(VALID_BODY.driver_user_id, CARRIER_EMP),
    );
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(
      `/assignments/${ASSIGNMENT_ID}/asignar-conductor`,
      makeReq(VALID_BODY, { 'x-test-userctx': CTX_DUENO }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'driver_not_in_carrier' }),
    );
  });
});
