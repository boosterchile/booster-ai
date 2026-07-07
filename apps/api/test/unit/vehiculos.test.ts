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
  typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
>[0]['logger'];

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const VEHICLE_ID = '22222222-2222-2222-2222-222222222222';

function buildVehicleRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VEHICLE_ID,
    empresaId: EMPRESA_ID,
    // Canónico (sin separadores, mayúsculas) — así lo persiste la BD tras
    // el transform de chileanPlateSchema.
    plate: 'ABCD12',
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
    const stub = makeDbStub({ selectRows: [{ id: VEHICLE_ID, plate: 'ABCD12' }] });
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

  it('POST / despachador puede crear (normaliza patente)', async () => {
    const stub = makeDbStub({ insertRows: [buildVehicleRow()] });
    const app = await buildApp(stub.db, { role: 'despachador' });
    const res = await app.request('/vehiculos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        // Input con minúsculas y separador. El servidor normaliza a canónico.
        plate: 'ab·cd·12',
        vehicle_type: 'camion_pequeno',
        capacity_kg: 3500,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { vehicle: { plate: string } };
    expect(body.vehicle.plate).toBe('ABCD12');
  });

  // ---------------------------------------------------------------------
  // BUG-002 — validación de formato chileno de patente.
  // ---------------------------------------------------------------------
  describe('validación de formato de patente', () => {
    /**
     * Envía POST /vehiculos con la patente indicada. Por default el stub del
     * DB devuelve la row con `plate: 'ABCD12'` de buildVehicleRow; los tests
     * que verifican la normalización del valor devuelto pueden pasar
     * `expectedNormalizedPlate` para que el stub responda con esa patente
     * (simulando que el handler ya normalizó antes de insertar).
     */
    async function postPlate(plate: string, expectedNormalizedPlate?: string) {
      const stub = makeDbStub({
        insertRows: [
          buildVehicleRow(expectedNormalizedPlate ? { plate: expectedNormalizedPlate } : {}),
        ],
      });
      const app = await buildApp(stub.db);
      return app.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate,
          vehicle_type: 'camion_pequeno',
          capacity_kg: 3500,
        }),
      });
    }

    it.each([
      ['cuatro puntos', '....'],
      ['XXX-99 (3 letras)', 'XXX-99'],
      ['1234 (solo dígitos)', '1234'],
      ['TEST-99 (4 letras pero 2 dígitos sí, espera... también pasa, ver abajo)', 'BCDF1A'], // dígito final letra
      ['emojis', '🚛🚛🚛🚛'],
      ['cadena vacía con espacios', '    '],
    ])('rechaza patente inválida (%s)', async (_label, plate) => {
      const res = await postPlate(plate);
      expect(res.status).toBe(400);
    });

    it('acepta patente nueva con guiones (BCDF-12 → BCDF12)', async () => {
      const res = await postPlate('BCDF-12', 'BCDF12');
      expect(res.status).toBe(201);
      const body = (await res.json()) as { vehicle: { plate: string } };
      expect(body.vehicle.plate).toBe('BCDF12');
    });

    it('acepta patente legacy AAAA·12 con punto medio', async () => {
      const res = await postPlate('AAAA·12', 'AAAA12');
      expect(res.status).toBe(201);
      const body = (await res.json()) as { vehicle: { plate: string } };
      expect(body.vehicle.plate).toBe('AAAA12');
    });
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

  // ---------------------------------------------------------------------
  // GET /flota — bulk para vista /app/flota (multi-vehículo + posición).
  // ---------------------------------------------------------------------
  describe('GET /flota', () => {
    /**
     * Stub específico para flota: 2 selects encadenados.
     *   1. select.from(vehicles).where().orderBy() → vehículos de empresa
     *   2. (si hay vehículos) selectDistinctOn.from(points).where().orderBy() → último punto por veh.
     */
    function makeFlotaStub(opts: {
      vehicleRows: Record<string, unknown>[];
      pointRows: Record<string, unknown>[];
    }) {
      const orderBySelect = vi.fn().mockResolvedValue(opts.vehicleRows);
      const whereSelect = vi.fn(() => ({ orderBy: orderBySelect }));
      const fromSelect = vi.fn(() => ({ where: whereSelect }));
      const selectFn = vi.fn(() => ({ from: fromSelect }));

      const orderByDistinct = vi.fn().mockResolvedValue(opts.pointRows);
      const whereDistinct = vi.fn(() => ({ orderBy: orderByDistinct }));
      const fromDistinct = vi.fn(() => ({ where: whereDistinct }));
      const selectDistinctOnFn = vi.fn(() => ({ from: fromDistinct }));

      return {
        db: { select: selectFn, selectDistinctOn: selectDistinctOnFn } as unknown as Parameters<
          typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
        >[0]['db'],
        spies: { selectFn, selectDistinctOnFn },
      };
    }

    it('sin auth → 401', async () => {
      const stub = makeFlotaStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db, { role: null });
      const res = await app.request('/vehiculos/flota');
      expect(res.status).toBe(401);
    });

    it('empresa sin vehículos → fleet vacía sin tocar telemetría', async () => {
      const stub = makeFlotaStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db);
      const res = await app.request('/vehiculos/flota');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { fleet: unknown[] };
      expect(body.fleet).toEqual([]);
      // Cuando no hay vehículos, no tiene sentido ir a buscar puntos.
      expect(stub.spies.selectDistinctOnFn).not.toHaveBeenCalled();
    });

    it('vehículos sin telemetría → position null', async () => {
      const stub = makeFlotaStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'BCDF12',
            type: 'camion_pequeno',
            teltonika_imei: null,
            status: 'activo',
          },
        ],
        pointRows: [],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/vehiculos/flota');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        fleet: Array<{ id: string; plate: string; position: unknown }>;
      };
      expect(body.fleet).toHaveLength(1);
      expect(body.fleet[0]?.position).toBeNull();
    });

    it('mergea último punto por vehículo con su position', async () => {
      const otherVehicleId = '33333333-3333-3333-3333-333333333333';
      const stub = makeFlotaStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'BCDF12',
            type: 'camion_pequeno',
            teltonika_imei: '999000000000875',
            status: 'activo',
          },
          {
            id: otherVehicleId,
            plate: 'AAAA11',
            type: 'furgon_mediano',
            teltonika_imei: null,
            status: 'activo',
          },
        ],
        pointRows: [
          {
            vehicle_id: VEHICLE_ID,
            timestamp_device: new Date('2026-05-10T22:00:00Z'),
            latitude: '-33.4489',
            longitude: '-70.6693',
            speed_kmh: 45,
            angle_deg: 180,
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/vehiculos/flota');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        fleet: Array<{
          id: string;
          plate: string;
          position: { latitude: number; longitude: number; speed_kmh: number | null } | null;
        }>;
      };
      expect(body.fleet).toHaveLength(2);
      const withPos = body.fleet.find((v) => v.id === VEHICLE_ID);
      const withoutPos = body.fleet.find((v) => v.id === otherVehicleId);
      expect(withPos?.position).not.toBeNull();
      expect(withPos?.position?.latitude).toBeCloseTo(-33.4489, 4);
      expect(withPos?.position?.longitude).toBeCloseTo(-70.6693, 4);
      expect(withPos?.position?.speed_kmh).toBe(45);
      expect(withoutPos?.position).toBeNull();
    });

    it('conductor (rol read) puede ver la flota', async () => {
      const stub = makeFlotaStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'BCDF12',
            type: 'camion_pequeno',
            teltonika_imei: null,
            status: 'activo',
          },
        ],
        pointRows: [],
      });
      const app = await buildApp(stub.db, { role: 'conductor' });
      const res = await app.request('/vehiculos/flota');
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/ubicacion — último punto GPS + temperatura (W3, IO 72 Dallas).
  // ---------------------------------------------------------------------
  describe('GET /:id/ubicacion', () => {
    /**
     * Stub específico para ubicación: 2 selects encadenados.
     *   1. select.from(vehicles).where().limit(1) → row del vehículo.
     *   2. select.from(telemetryPoints | posicionesMovilConductor)
     *      .where().orderBy().limit(1) → último punto.
     * Ambos caminos usan formas de chain distintas (limit directo vs
     * orderBy().limit()) así que un mismo par de mocks no se pisa.
     */
    function makeUbicacionStub(opts: {
      vehicleRows: Record<string, unknown>[];
      pointRows: Record<string, unknown>[];
    }) {
      const limitFn = vi.fn().mockResolvedValue(opts.vehicleRows);
      const orderByLimitFn = vi.fn().mockResolvedValue(opts.pointRows);
      const orderByFn = vi.fn(() => ({ limit: orderByLimitFn }));
      const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      const selectFn = vi.fn(() => ({ from: fromFn }));
      return {
        db: { select: selectFn } as unknown as Parameters<
          typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
        >[0]['db'],
        spies: { selectFn, fromFn, whereFn, limitFn, orderByFn, orderByLimitFn },
      };
    }

    interface UbicacionBody {
      vehicle_id: string;
      teltonika_source: string | null;
      ubicacion: {
        temperatura_c: number | null;
        temperatura_registrada_en: string | null;
      };
    }

    it('sin auth → 401', async () => {
      const stub = makeUbicacionStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db, { role: null });
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(401);
    });

    it('vehículo no encontrado → 404', async () => {
      const stub = makeUbicacionStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(404);
    });

    it('Teltonika propio con IO 72 positivo → temperatura_c + temperatura_registrada_en', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:00:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:00:01Z'),
            longitude: '-71.2519',
            latitude: '-29.9027',
            altitude_m: 30,
            angle_deg: 180,
            satellites: 11,
            speed_kmh: 60,
            priority: 1,
            io_data: { '72': 55 }, // 5.5°C
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBeCloseTo(5.5, 5);
      expect(body.ubicacion.temperatura_registrada_en).toBe('2026-07-06T10:00:00.000Z');
    });

    it("Teltonika propio con IO 72 negativo (two's complement) → temperatura_c negativo", async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:05:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:05:01Z'),
            longitude: '-71.3000',
            latitude: '-29.9300',
            altitude_m: 15,
            angle_deg: 200,
            satellites: 10,
            speed_kmh: 55,
            priority: 1,
            io_data: { '72': 0xff38 }, // -20.0°C
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBeCloseTo(-20, 5);
    });

    it('Teltonika propio SIN IO 72 en io_data → temperatura_c null explícito', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:10:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:10:01Z'),
            longitude: '-71.3100',
            latitude: '-29.9400',
            altitude_m: 20,
            angle_deg: 210,
            satellites: 9,
            speed_kmh: 40,
            priority: 1,
            io_data: { '239': 1, '240': 1 }, // sin IO 72
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBeNull();
      expect(body.ubicacion.temperatura_registrada_en).toBeNull();
    });

    it('Teltonika propio con IO 72 fuera de rango físico (sensor desconectado) → temperatura_c null', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:15:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:15:01Z'),
            longitude: '-71.3200',
            latitude: '-29.9450',
            altitude_m: 18,
            angle_deg: 220,
            satellites: 9,
            speed_kmh: 35,
            priority: 1,
            io_data: { '72': 1300 }, // 130.0°C, imposible para DS18B20
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBeNull();
    });

    it('Teltonika espejo (mirror) con IO 72 → temperatura_c calculado igual que propio', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: null,
            teltonikaImeiEspejo: '999000000000875',
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:20:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:20:01Z'),
            longitude: '-71.3300',
            latitude: '-29.9500',
            altitude_m: 12,
            angle_deg: 230,
            satellites: 8,
            speed_kmh: 30,
            priority: 1,
            io_data: { '72': 80 }, // 8.0°C
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.teltonika_source).toBe('mirror');
      expect(body.ubicacion.temperatura_c).toBeCloseTo(8.0, 5);
    });

    it('fallback browser_gps (sin Teltonika) → temperatura_c SIEMPRE null', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: null,
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-06T10:25:00Z'),
            timestamp_received_at: new Date('2026-07-06T10:25:01Z'),
            latitude: '-29.9500',
            longitude: '-71.3300',
            speed_kmh: '20',
            heading_deg: 240,
            accuracy_m: '5.0',
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.teltonika_source).toBe('browser_gps');
      expect(body.ubicacion.temperatura_c).toBeNull();
      expect(body.ubicacion.temperatura_registrada_en).toBeNull();
    });

    it('sin Teltonika y sin punto de browser → 404 no_teltonika', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: null,
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('no_teltonika');
    });

    it('con Teltonika pero sin puntos aún → 404 no_points_yet', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('no_points_yet');
    });
  });
});
