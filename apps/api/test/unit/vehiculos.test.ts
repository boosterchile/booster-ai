import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
>[0]['logger'];

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';

function buildVehicleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VEHICLE_ID,
    empresaId: EMPRESA_ID,
    plate: 'AB-CD-12',
    vehicleType: 'camion_pequeno',
    capacityKg: 3500,
    capacityM3: null,
    year: null,
    brand: null,
    model: null,
    fuelType: null,
    curbWeightKg: null,
    consumptionLPer100kmBaseline: null,
    teltonikaImei: null,
    lastInspectionAt: null,
    inspectionExpiresAt: null,
    vehicleStatus: 'activo',
    createdAt: new Date('2026-05-02T00:00:00Z'),
    updatedAt: new Date('2026-05-02T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Stub fluent del db drizzle. Cada operación (select / insert / update) se
 * encadena hasta `returning()` o `limit()` que resuelve con `rows`.
 */
function makeDbStub(opts: {
  selectRows?: Record<string, unknown>[];
  insertRows?: Record<string, unknown>[];
  updateRows?: Record<string, unknown>[];
  insertError?: { code: string };
}) {
  // SELECT chain: db.select().from().where().limit() | .orderBy()
  const limitSelect = vi.fn().mockResolvedValue(opts.selectRows ?? []);
  const orderBySelect = vi.fn().mockResolvedValue(opts.selectRows ?? []);
  const whereSelect = vi.fn(() => ({ limit: limitSelect, orderBy: orderBySelect }));
  const fromSelect = vi.fn(() => ({ where: whereSelect, orderBy: orderBySelect }));
  const selectFn = vi.fn(() => ({ from: fromSelect }));

  // INSERT chain: db.insert().values().returning()
  const returningInsert = opts.insertError
    ? vi.fn().mockRejectedValue(opts.insertError)
    : vi.fn().mockResolvedValue(opts.insertRows ?? []);
  const valuesInsert = vi.fn(() => ({ returning: returningInsert }));
  const insertFn = vi.fn(() => ({ values: valuesInsert }));

  // UPDATE chain: db.update().set().where().returning()
  const returningUpdate = vi.fn().mockResolvedValue(opts.updateRows ?? []);
  const whereUpdate = vi.fn(() => ({ returning: returningUpdate }));
  const setUpdate = vi.fn(() => ({ where: whereUpdate }));
  const updateFn = vi.fn(() => ({ set: setUpdate }));

  return {
    db: { select: selectFn, insert: insertFn, update: updateFn } as unknown as Parameters<
      typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
    >[0]['db'],
    spies: { selectFn, insertFn, updateFn, valuesInsert, setUpdate },
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes>[0]['db'],
  opts: { role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null } = {
    role: 'dueno',
  },
) {
  const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.role === null) {
      // sin userContext = unauthorized
      await next();
      return;
    }
    c.set('userContext', {
      user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm-1', role: opts.role },
        empresa: { id: EMPRESA_ID, legal_name: 'Test SA' },
      },
    });
    await next();
  });
  app.route('/vehiculos', createVehiculosRoutes({ db, logger: noopLogger }));
  return app;
}

describe('vehiculos routes', () => {
  it('GET / sin auth → 401', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: null });
    const res = await app.request('/vehiculos');
    expect(res.status).toBe(401);
  });

  it('GET / lista vehiculos de la empresa activa', async () => {
    const stub = makeDbStub({ selectRows: [{ id: VEHICLE_ID, plate: 'AB-CD-12' }] });
    const app = await buildApp(stub.db);
    const res = await app.request('/vehiculos');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vehicles: unknown[] };
    expect(body.vehicles).toHaveLength(1);
  });

  it('POST / sin role write → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: 'conductor' });
    const res = await app.request('/vehiculos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plate: 'AB-CD-12',
        vehicle_type: 'camion_pequeno',
        capacity_kg: 3500,
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('write_role_required');
  });

  it('POST / despachador puede crear', async () => {
    const stub = makeDbStub({ insertRows: [buildVehicleRow()] });
    const app = await buildApp(stub.db, { role: 'despachador' });
    const res = await app.request('/vehiculos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plate: 'ab-cd-12',
        vehicle_type: 'camion_pequeno',
        capacity_kg: 3500,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { vehicle: { plate: string } };
    expect(body.vehicle.plate).toBe('AB-CD-12'); // upper-cased por el plateSchema transform
  });

  it('POST / patente duplicada → 409', async () => {
    const stub = makeDbStub({ insertError: { code: '23505' } });
    const app = await buildApp(stub.db);
    const res = await app.request('/vehiculos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plate: 'AB-CD-12',
        vehicle_type: 'camion_pequeno',
        capacity_kg: 3500,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('plate_duplicate');
  });

  it('POST / valida campos requeridos (sin plate → 400)', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request('/vehiculos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehicle_type: 'camion_pequeno', capacity_kg: 3500 }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id no encontrado → 404', async () => {
    const stub = makeDbStub({ selectRows: [] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/vehiculos/${VEHICLE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2020 }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH /:id actualiza campos parciales', async () => {
    const stub = makeDbStub({
      selectRows: [{ id: VEHICLE_ID }],
      updateRows: [buildVehicleRow({ year: 2020, brand: 'Mercedes' })],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/vehiculos/${VEHICLE_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ year: 2020, brand: 'Mercedes' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vehicle: { year: number; brand: string } };
    expect(body.vehicle.year).toBe(2020);
    expect(body.vehicle.brand).toBe('Mercedes');
  });

  it('DELETE /:id como conductor → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: 'despachador' });
    const res = await app.request(`/vehiculos/${VEHICLE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('DELETE /:id como dueno → soft delete (vehicleStatus=retirado)', async () => {
    const stub = makeDbStub({
      updateRows: [buildVehicleRow({ vehicleStatus: 'retirado' })],
    });
    const app = await buildApp(stub.db, { role: 'dueno' });
    const res = await app.request(`/vehiculos/${VEHICLE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { vehicle: { status: string } };
    expect(body.vehicle.status).toBe('retirado');
  });

  it('DELETE /:id no encontrado → 404', async () => {
    const stub = makeDbStub({ updateRows: [] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/vehiculos/${VEHICLE_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('GET /:id/telemetria devuelve puntos del vehículo', async () => {
    // Stub más complejo: 2 calls a select consecutivos. Primero devuelve el
    // vehículo (ownership check), después devuelve los puntos.
    let selectCallCount = 0;
    const limitFn = vi.fn(() => {
      selectCallCount += 1;
      if (selectCallCount === 1) {
        return Promise.resolve([
          { id: VEHICLE_ID, plate: 'AB-CD-12', teltonikaImei: '999000000000875' },
        ]);
      }
      return Promise.resolve([]);
    });
    const orderByLimitFn = vi.fn().mockResolvedValue([
      {
        id: 1n,
        imei: '999000000000875',
        timestamp_device: new Date('2026-05-02T16:00:00Z'),
        timestamp_received_at: new Date('2026-05-02T16:00:01Z'),
        priority: 1,
        longitude: '-70.6693',
        latitude: '-33.4489',
        altitude_m: 560,
        angle_deg: 180,
        satellites: 12,
        speed_kmh: 45,
        event_io_id: 0,
      },
    ]);
    const orderByFn = vi.fn(() => ({ limit: orderByLimitFn }));
    const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
    const fromFn = vi.fn(() => ({ where: whereFn }));
    const selectFn = vi.fn(() => ({ from: fromFn }));
    const db = { select: selectFn } as unknown as Parameters<
      typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
    >[0]['db'];
    const app = await buildApp(db);
    const res = await app.request(`/vehiculos/${VEHICLE_ID}/telemetria`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; points: unknown[] };
    expect(body.count).toBe(1);
    expect(body.points).toHaveLength(1);
  });

  it('GET /:id/telemetria 404 si vehículo no existe', async () => {
    const stub = makeDbStub({ selectRows: [] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/vehiculos/${VEHICLE_ID}/telemetria`);
    expect(res.status).toBe(404);
  });
});
