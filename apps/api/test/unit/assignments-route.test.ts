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
vi.mock('../../src/services/confirmar-recogida-viaje.js', () => ({
  confirmarRecogidaViaje: vi.fn(),
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
const { confirmarRecogidaViaje } = await import('../../src/services/confirmar-recogida-viaje.js');
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
      // Las queries de listado terminan en `.orderBy()` (sin `limit`), así que
      // la cadena tiene que ser awaitable por sí misma, no solo vía `limit`.
      then: (resolve: (v: unknown) => unknown) => resolve(selects.shift() ?? []),
    };
    return chain;
  };

  const insertValues = vi.fn(async () => undefined);
  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => ({ values: insertValues })),
    /** Spy sobre `.values(...)` del insert (driver-position persiste la posición). */
    insertValues,
  };
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
      // T9: radio del geofence del origen (prod: config.GEOFENCE_RADIUS_M).
      geofenceRadiusM: 150,
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

// ---------------------------------------------------------------------------
// GET /assignments — listado de la empresa activa.
//
// Existe porque no había forma de LLEGAR a asignar un conductor: la pantalla
// que lo hace (`/app/asignaciones/:id`) no estaba en el menú y solo se
// alcanzaba desde Cobra Hoy y Liquidaciones. Medido en prod 2026-08-03: 0 de
// 6 conductores activados y 0 asignaciones con conductor, con 1 activa.
// ---------------------------------------------------------------------------

const LISTA_ROW = {
  assignmentId: ASSIGNMENT_ID,
  assignmentStatus: 'asignado',
  acceptedAt: new Date('2026-08-01T10:00:00Z'),
  pickedUpAt: null,
  agreedPriceClp: 850000,
  driverUserId: null,
  driverName: null,
  vehicleId: 'veh-uuid',
  vehiclePlate: 'UICO01',
  tripId: TRIP_ID,
  trackingCode: 'BOO-4F2A',
  tripStatus: 'asignado',
  originAddressRaw: 'Av. Presidente Riesco 5335',
  originRegionCode: '13',
  destinationAddressRaw: 'Ruta 5 Sur km 1020',
  destinationRegionCode: '10',
  cargoType: 'carga_seca',
  cargoWeightKg: 12000,
  pickupWindowStart: null,
  pickupWindowEnd: null,
};

describe('GET /assignments', () => {
  it('sin userContext → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/assignments');
    expect(res.status).toBe(401);
  });

  it('sin activeMembership → 403 no_active_empresa', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/assignments', {
      headers: {
        'x-test-userctx': JSON.stringify({ user: { id: 'u' }, activeMembership: null }),
      },
    });
    expect(res.status).toBe(403);
  });

  it('empresa no transportista → 403 not_a_carrier', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request('/assignments', {
      headers: {
        'x-test-userctx': JSON.stringify({
          user: { id: USER_ID },
          activeMembership: { empresa: { id: 'e', isTransportista: false, status: 'activa' } },
        }),
      },
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as { code: string }).toEqual(
      expect.objectContaining({ code: 'not_a_carrier' }),
    );
  });

  it('devuelve los servicios de la empresa con el conductor explícito', async () => {
    const app = await buildApp({ db: makeDb({ selects: [[LISTA_ROW]] }) });
    const res = await app.request('/assignments', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments: Array<{
        id: string;
        driver: { user_id: string; full_name: string } | null;
        vehicle: { plate: string } | null;
        trip: { tracking_code: string; origin: { address_raw: string } };
      }>;
    };
    expect(body.assignments).toHaveLength(1);
    const a = body.assignments[0];
    expect(a?.id).toBe(ASSIGNMENT_ID);
    // `driver: null` es EL dato de esta pantalla: es lo que la marca como
    // "sin conductor" y dispara la acción. Si viniera omitido, la UI no
    // podría distinguir "sin conductor" de "no me lo mandaron".
    expect(a?.driver).toBeNull();
    expect(a?.vehicle?.plate).toBe('UICO01');
    expect(a?.trip.tracking_code).toBe('BOO-4F2A');
    expect(a?.trip.origin.address_raw).toBe('Av. Presidente Riesco 5335');
  });

  it('con conductor asignado lo devuelve con nombre', async () => {
    const app = await buildApp({
      db: makeDb({
        selects: [[{ ...LISTA_ROW, driverUserId: 'drv-1', driverName: 'Pedro Conductor' }]],
      }),
    });
    const res = await app.request('/assignments', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    const body = (await res.json()) as {
      assignments: Array<{ driver: { user_id: string; full_name: string } | null }>;
    };
    expect(body.assignments[0]?.driver).toEqual({
      user_id: 'drv-1',
      full_name: 'Pedro Conductor',
    });
  });

  it('sin servicios → lista vacía, no error', async () => {
    const app = await buildApp({ db: makeDb({ selects: [[]] }) });
    const res = await app.request('/assignments', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { assignments: unknown[] }).toEqual({ assignments: [] });
  });

  it('una fecha inválida no rompe la respuesta entera', async () => {
    // Mismo blindaje que `/me/assignments`: un Date con time NaN hace que
    // `toISOString()` tire RangeError y se lleve puesto el 200 completo.
    const app = await buildApp({
      db: makeDb({ selects: [[{ ...LISTA_ROW, acceptedAt: new Date('no-es-fecha') }]] }),
    });
    const res = await app.request('/assignments', {
      headers: { 'x-test-userctx': VALID_CTX },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignments: Array<{ accepted_at: string | null }> };
    expect(body.assignments[0]?.accepted_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PATCH /assignments/:id/confirmar-recogida
//
// Cierra el paso muerto de la máquina de estados: `asignaciones: asignado →
// recogido` y `viajes: asignado → en_proceso` estaban modelados desde 2026-06
// sin nadie que los escribiera.
// ---------------------------------------------------------------------------

describe('PATCH /assignments/:id/confirmar-recogida', () => {
  function ctxConRol(role: string, empresaId = CARRIER_EMP) {
    return JSON.stringify({
      user: { id: USER_ID },
      activeMembership: {
        membership: { role },
        empresa: { id: empresaId, isTransportista: true, status: 'activa' },
      },
    });
  }

  it('sin userContext → 401', async () => {
    const app = await buildApp({ db: makeDb() });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
    });
    expect(res.status).toBe(401);
  });

  it('conductor asignado → 200 y el service lo recibe como conductor', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
      ok: true,
      alreadyPickedUp: false,
      pickedUpAt: new Date('2026-08-03T06:00:00Z'),
      tripId: TRIP_ID,
    });
    const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('conductor') },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toEqual(
      expect.objectContaining({ ok: true, already_picked_up: false }),
    );
    expect(vi.mocked(confirmarRecogidaViaje).mock.calls[0]?.[0].actor).toEqual(
      expect.objectContaining({ esConductorAsignado: true, esCarrierConEscritura: false }),
    );
  });

  it('despachador (no conductor) → llega como carrier con escritura', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
      ok: true,
      alreadyPickedUp: false,
      pickedUpAt: new Date(),
      tripId: TRIP_ID,
    });
    const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: 'otro' }]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('despachador') },
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(confirmarRecogidaViaje).mock.calls[0]?.[0].actor).toEqual(
      expect.objectContaining({ esConductorAsignado: false, esCarrierConEscritura: true }),
    );
  });

  it('visualizador que no es el conductor → llega sin ningún privilegio', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({ ok: false, code: 'forbidden' });
    const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: 'otro' }]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('visualizador') },
    });
    expect(res.status).toBe(403);
    expect(vi.mocked(confirmarRecogidaViaje).mock.calls[0]?.[0].actor).toEqual(
      expect.objectContaining({ esConductorAsignado: false, esCarrierConEscritura: false }),
    );
  });

  it('idempotente → 200 con already_picked_up', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
      ok: true,
      alreadyPickedUp: true,
      pickedUpAt: new Date('2026-08-03T05:00:00Z'),
      tripId: TRIP_ID,
    });
    const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('conductor') },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { already_picked_up: boolean }).toEqual(
      expect.objectContaining({ already_picked_up: true }),
    );
  });

  it('assignment inexistente → 404', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
      ok: false,
      code: 'assignment_not_found',
    });
    const app = await buildApp({ db: makeDb({ selects: [[]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('despachador') },
    });
    expect(res.status).toBe(404);
  });

  it('ya entregado → 409 invalid_status con el estado actual', async () => {
    vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
      ok: false,
      code: 'invalid_status',
      currentStatus: 'entregado',
    });
    const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
      method: 'PATCH',
      headers: { 'x-test-userctx': ctxConRol('conductor') },
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as { current_status: string }).toEqual(
      expect.objectContaining({ code: 'invalid_status', current_status: 'entregado' }),
    );
  });

  // T9 (medicion-huella-segmento): body opcional `{ picked_up_at }` = instante
  // del cruce del geofence. Zod valida la forma acá; las cotas (ni futuro ni
  // anterior a la aceptación) las aplica el service.
  describe('body opcional picked_up_at (T9)', () => {
    it('picked_up_at ISO válido → el service lo recibe como Date', async () => {
      const cruce = '2026-08-02T09:30:00.000Z';
      vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
        ok: true,
        alreadyPickedUp: false,
        pickedUpAt: new Date(cruce),
        tripId: TRIP_ID,
      });
      const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
      const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
        method: 'PATCH',
        headers: { 'x-test-userctx': ctxConRol('conductor'), 'content-type': 'application/json' },
        body: JSON.stringify({ picked_up_at: cruce }),
      });
      expect(res.status).toBe(200);
      expect(vi.mocked(confirmarRecogidaViaje).mock.calls[0]?.[0].pickedUpAt).toEqual(
        new Date(cruce),
      );
      expect((await res.json()) as { picked_up_at: string }).toEqual(
        expect.objectContaining({ picked_up_at: cruce }),
      );
    });

    it('sin body → el service NO recibe pickedUpAt (tap manual = now en el servidor)', async () => {
      vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
        ok: true,
        alreadyPickedUp: false,
        pickedUpAt: new Date(),
        tripId: TRIP_ID,
      });
      const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
      const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
        method: 'PATCH',
        headers: { 'x-test-userctx': ctxConRol('conductor') },
      });
      expect(res.status).toBe(200);
      expect(vi.mocked(confirmarRecogidaViaje).mock.calls[0]?.[0].pickedUpAt).toBeUndefined();
    });

    it('picked_up_at que no es ISO datetime → 400 y el service no se llama', async () => {
      const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
      const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
        method: 'PATCH',
        headers: { 'x-test-userctx': ctxConRol('conductor'), 'content-type': 'application/json' },
        body: JSON.stringify({ picked_up_at: 'ayer a las nueve' }),
      });
      expect(res.status).toBe(400);
      expect(confirmarRecogidaViaje).not.toHaveBeenCalled();
    });

    it('service rechaza el instante (fuera de cotas) → 400 invalid_picked_up_at', async () => {
      vi.mocked(confirmarRecogidaViaje).mockResolvedValueOnce({
        ok: false,
        code: 'invalid_picked_up_at',
      });
      const app = await buildApp({ db: makeDb({ selects: [[{ driverUserId: USER_ID }]] }) });
      const res = await app.request(`/assignments/${ASSIGNMENT_ID}/confirmar-recogida`, {
        method: 'PATCH',
        headers: { 'x-test-userctx': ctxConRol('conductor'), 'content-type': 'application/json' },
        body: JSON.stringify({ picked_up_at: '2099-01-01T00:00:00.000Z' }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()) as { code: string }).toEqual(
        expect.objectContaining({ code: 'invalid_picked_up_at' }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// POST /assignments/:id/driver-position — T9 (medicion-huella-segmento): la
// respuesta trae el veredicto del geofence del origen evaluado en servidor
// (`evaluarGeofenceOrigen`, T8) para que la PWA sugiera la recogida.
// ---------------------------------------------------------------------------

describe('POST /assignments/:id/driver-position — geofence del origen', () => {
  const DRIVER_CTX = JSON.stringify({ user: { id: USER_ID } });
  /** Origen geocodificado (Av. Apoquindo, Las Condes) tal como lo persiste T4: numeric → string. */
  const ORIGEN = { originLatitude: '-33.4188917', originLongitude: '-70.6045211' };

  function assignmentRow(origen: {
    originLatitude: string | null;
    originLongitude: string | null;
  }) {
    return {
      id: ASSIGNMENT_ID,
      driverUserId: USER_ID,
      vehicleId: 'veh-uuid',
      status: 'asignado',
      ...origen,
    };
  }

  function bodyAt(lat: number, lng: number) {
    return JSON.stringify({
      timestamp_device: '2026-08-02T09:30:00.000Z',
      latitude: lat,
      longitude: lng,
      accuracy_m: 8,
    });
  }

  it('posición dentro del radio → 200 con geofence.estado=dentro y distancia_m', async () => {
    const db = makeDb({ selects: [[assignmentRow(ORIGEN)]] });
    const app = await buildApp({ db });
    // ~50 m al norte del origen.
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': DRIVER_CTX, 'content-type': 'application/json' },
      body: bodyAt(-33.4188917 + 50 / 111_195, -70.6045211),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      geofence: { estado: string; distancia_m: number | null };
    };
    expect(json.ok).toBe(true);
    expect(json.geofence.estado).toBe('dentro');
    expect(json.geofence.distancia_m).toBeCloseTo(50, 0);
    // La posición se sigue persistiendo igual que antes.
    expect(db.insertValues).toHaveBeenCalledTimes(1);
  });

  it('posición a ~500 m → geofence.estado=fuera', async () => {
    const app = await buildApp({ db: makeDb({ selects: [[assignmentRow(ORIGEN)]] }) });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': DRIVER_CTX, 'content-type': 'application/json' },
      body: bodyAt(-33.4188917 + 500 / 111_195, -70.6045211),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { geofence: { estado: string; distancia_m: number | null } };
    expect(json.geofence.estado).toBe('fuera');
    expect(json.geofence.distancia_m).toBeCloseTo(500, -1);
  });

  it('viaje sin origen geocodificado (NULL) → 200 con geofence.estado=sin_origen, nunca error', async () => {
    const db = makeDb({
      selects: [[assignmentRow({ originLatitude: null, originLongitude: null })]],
    });
    const app = await buildApp({ db });
    const res = await app.request(`/assignments/${ASSIGNMENT_ID}/driver-position`, {
      method: 'POST',
      headers: { 'x-test-userctx': DRIVER_CTX, 'content-type': 'application/json' },
      body: bodyAt(-33.4188917, -70.6045211),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      geofence: { estado: string; distancia_m: number | null };
    };
    expect(json.ok).toBe(true);
    expect(json.geofence).toEqual({ estado: 'sin_origen', distancia_m: null });
    expect(db.insertValues).toHaveBeenCalledTimes(1);
  });
});
