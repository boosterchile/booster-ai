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

/**
 * Logger con spy en `.info` — usado por los tests de la derivación C1
 * (fix review W4a) que necesitan asertar que el log estructurado se emite
 * (o no se emite) exactamente en las condiciones esperadas.
 */
function buildSpyLogger() {
  const info = vi.fn();
  const spyLogger: Record<string, unknown> = {
    trace: noop,
    debug: noop,
    info,
    warn: noop,
    error: noop,
    fatal: noop,
  };
  spyLogger.child = () => spyLogger;
  return {
    logger: spyLogger as unknown as Parameters<
      typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
    >[0]['logger'],
    info,
  };
}

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
    unitCategory: 'motriz',
    unitType: 'camion_rigido',
    bodyType: null,
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
  opts: {
    role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null;
    logger?: Parameters<
      typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
    >[0]['logger'];
    obtenerClima?: (lat: number, lng: number) => Promise<number | null>;
  } = {},
) {
  // Merge explícito (no reemplazo posicional): pasar solo `{ logger }` no
  // debe perder el default `role: 'dueno'`.
  const role = opts.role === undefined ? 'dueno' : opts.role;
  const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (role === null) {
      // sin userContext = unauthorized
      await next();
      return;
    }
    c.set('userContext', {
      user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm-1', role },
        empresa: { id: EMPRESA_ID, legal_name: 'Test SA' },
      },
    });
    await next();
  });
  app.route(
    '/vehiculos',
    createVehiculosRoutes({
      db,
      logger: opts.logger ?? noopLogger,
      ...(opts.obtenerClima ? { obtenerClima: opts.obtenerClima } : {}),
    }),
  );
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
        unit_type: 'camion_rigido',
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
        unit_type: 'camion_rigido',
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
          unit_type: 'camion_rigido',
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
        unit_type: 'camion_rigido',
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

  // ---------------------------------------------------------------------
  // W4a (migración 0048, ADR-073) — D4 condición 3: CHECK tipo↔categoría
  // (+ D4.5) validada en Zod ANTES de BD (422). D4.2 originalmente exigía
  // `unit_type` obligatorio (400 si faltaba) en toda escritura nueva; el fix
  // C1 (review W4a, decisión PO opción b, 2026-07-06) lo reemplazó por
  // derivación server-side desde `vehicle_type` cuando `unit_type` no viene
  // — ver el describe `derivación de unit_type desde vehicle_type en create
  // (fix C1, ADR-073)` más abajo para la cobertura completa (9 mappings +
  // no-pisa-input-explícito + guard de exhaustividad).
  // ---------------------------------------------------------------------
  describe('tipologías de flota (D1/D4, W4a)', () => {
    it('POST / sin unit_type → ya NO es 400 (fix C1): deriva desde vehicle_type y crea 201', async () => {
      const stub = makeDbStub({
        insertRows: [buildVehicleRow({ vehicleType: 'camion_pequeno', unitType: 'camion_rigido' })],
      });
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camion_pequeno',
          capacity_kg: 3500,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { vehicle: { unit_category: string; unit_type: string } };
      expect(body.vehicle.unit_category).toBe('motriz');
      expect(body.vehicle.unit_type).toBe('camion_rigido');
    });

    it('POST / unit_category=motriz + unit_type=semirremolque → 422 (incoherente, espejo del CHECK)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'semi_remolque',
          unit_category: 'motriz',
          unit_type: 'semirremolque',
          capacity_kg: 30000,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('tipo_categoria_incoherente');
    });

    it('POST / arrastre sin curb_weight_kg → 422 (D4.5)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'semi_remolque',
          unit_category: 'arrastre',
          unit_type: 'semirremolque',
          capacity_kg: 30000,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('arrastre_curb_weight_requerido');
    });

    it('POST / arrastre con fuel_type declarado → 422 (D4.5: arrastre no tiene combustible propio)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'semi_remolque',
          unit_category: 'arrastre',
          unit_type: 'semirremolque',
          capacity_kg: 30000,
          curb_weight_kg: 7000,
          fuel_type: 'diesel',
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('arrastre_combustible_debe_ser_null');
    });

    it('POST / arrastre coherente (semirremolque, capacity/curb_weight > 0) → 201', async () => {
      const stub = makeDbStub({
        insertRows: [
          buildVehicleRow({
            unitCategory: 'arrastre',
            unitType: 'semirremolque',
            capacityKg: 30000,
            curbWeightKg: 7000,
            fuelType: null,
            consumptionLPer100kmBaseline: null,
          }),
        ],
      });
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'semi_remolque',
          unit_category: 'arrastre',
          unit_type: 'semirremolque',
          capacity_kg: 30000,
          curb_weight_kg: 7000,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { vehicle: { unit_category: string; unit_type: string } };
      expect(body.vehicle.unit_category).toBe('arrastre');
      expect(body.vehicle.unit_type).toBe('semirremolque');
    });

    // D4 (decisiones.md línea 30, texto vinculante): "tracto_camion →
    // capacity_kg = 0 permitido y consumo requerido". Un tracto no carga
    // solo, pero sí tiene motor propio: consumption_l_per_100km_baseline y
    // fuel_type son obligatorios (a diferencia de curb_weight_kg, que
    // sigue nullable "como hoy" para motriz).
    it('POST / tracto_camion completo (capacity_kg=0 + consumo + fuel) → 201 (D1.2 + D4)', async () => {
      const stub = makeDbStub({
        insertRows: [
          buildVehicleRow({
            vehicleType: 'camion_pesado',
            unitCategory: 'motriz',
            unitType: 'tracto_camion',
            capacityKg: 0,
            fuelType: 'diesel',
            consumptionLPer100kmBaseline: '33',
          }),
        ],
      });
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camion_pesado',
          unit_category: 'motriz',
          unit_type: 'tracto_camion',
          capacity_kg: 0,
          fuel_type: 'diesel',
          consumption_l_per_100km_baseline: 33,
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST / tracto_camion sin consumo/fuel → 422 (tracto_consumo_requerido, D4)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camion_pesado',
          unit_category: 'motriz',
          unit_type: 'tracto_camion',
          capacity_kg: 0,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('tracto_consumo_requerido');
    });

    it('POST / tracto_camion con consumo pero sin fuel_type → 422 (tracto_combustible_requerido, D4)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camion_pesado',
          unit_category: 'motriz',
          unit_type: 'tracto_camion',
          capacity_kg: 0,
          consumption_l_per_100km_baseline: 33,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('tracto_combustible_requerido');
    });

    it('POST / motriz no-tracto con capacity_kg=0 → 422 (motriz_capacidad_requerida)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camioneta',
          unit_category: 'motriz',
          unit_type: 'camioneta',
          capacity_kg: 0,
        }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('motriz_capacidad_requerida');
    });

    it('PATCH /:id que solo cambia capacity_kg re-valida coherencia mergeando con el estado persistido → 422', async () => {
      // Fila existente: arrastre semirremolque coherente (capacity=30000,
      // curb_weight=7000). El PATCH solo manda capacity_kg=0 — el merge
      // con unit_category='arrastre' persistido debe detectar la violación
      // (arrastre requiere capacity_kg > 0), aunque el body del PATCH no
      // toque unit_category/unit_type.
      const stub = makeDbStub({
        selectRows: [
          {
            id: VEHICLE_ID,
            unitCategory: 'arrastre',
            unitType: 'semirremolque',
            capacityKg: 30000,
            curbWeightKg: 7000,
            consumptionLPer100kmBaseline: null,
            fuelType: null,
          },
        ],
      });
      const localApp = await buildApp(stub.db);
      const res = await localApp.request(`/vehiculos/${VEHICLE_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ capacity_kg: 0 }),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('arrastre_capacidad_requerida');
    });

    it('PATCH /:id que no toca campos de coherencia → no re-valida (200 normal)', async () => {
      const stub = makeDbStub({
        selectRows: [
          {
            id: VEHICLE_ID,
            unitCategory: 'arrastre',
            unitType: 'semirremolque',
            capacityKg: 30000,
            curbWeightKg: 7000,
            consumptionLPer100kmBaseline: null,
            fuelType: null,
          },
        ],
        updateRows: [buildVehicleRow({ year: 2021 })],
      });
      const localApp = await buildApp(stub.db);
      const res = await localApp.request(`/vehiculos/${VEHICLE_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ year: 2021 }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------
  // Fix C1 (review W4a, decisión PO opción b, 2026-07-06): el form web
  // actual (apps/web/src/routes/vehiculos.tsx, vehicleFormToBody) todavía no
  // manda `unit_type` en el create — romper el form no es opción (W4b lo
  // arregla). El server DERIVA `unit_type`/`unit_category`/`body_type`
  // desde `vehicle_type` con el mismo mapping D4 del backfill (migración
  // 0048), vía `derivarUnidadDesdeTipoLegacy` (packages/shared-schemas). Si
  // `unit_type` SÍ viene explícito, la derivación no dispara (no pisa input
  // explícito).
  // ---------------------------------------------------------------------
  describe('derivación de unit_type desde vehicle_type en create (fix C1, ADR-073)', () => {
    // Los 9 valores de vehicleTypeSchema, table-driven, mismo mapping D4 del
    // backfill SQL (0048) y de derivarUnidadDesdeTipoLegacy. `semi_remolque`
    // deriva a `arrastre` — arrastre exige curb_weight_kg > 0 (D4.5), así
    // que ese caso manda el campo explícito (no forma parte de lo que la
    // derivación de unit_type resuelve).
    it.each([
      ['camioneta', {}, 'motriz', 'camioneta', null],
      ['furgon_pequeno', {}, 'motriz', 'furgon', 'furgon_cerrado'],
      ['furgon_mediano', {}, 'motriz', 'furgon', 'furgon_cerrado'],
      ['camion_pequeno', {}, 'motriz', 'camion_rigido', null],
      ['camion_mediano', {}, 'motriz', 'camion_rigido', null],
      ['camion_pesado', {}, 'motriz', 'camion_rigido', null],
      ['semi_remolque', { curb_weight_kg: 7000 }, 'arrastre', 'semirremolque', null],
      ['refrigerado', {}, 'motriz', 'camion_rigido', 'refrigerado'],
      ['tanque', {}, 'motriz', 'camion_rigido', 'cisterna'],
    ] as const)(
      'POST / sin unit_type, vehicle_type=%s → 201 con unidad derivada + log emitido',
      async (
        vehicleType,
        extraFields,
        expectedUnitCategory,
        expectedUnitType,
        expectedBodyType,
      ) => {
        const spy = buildSpyLogger();
        const stub = makeDbStub({
          insertRows: [
            buildVehicleRow({
              vehicleType,
              unitCategory: expectedUnitCategory,
              unitType: expectedUnitType,
              bodyType: expectedBodyType,
              capacityKg: 1000,
              curbWeightKg: 'curb_weight_kg' in extraFields ? extraFields.curb_weight_kg : null,
            }),
          ],
        });
        const localApp = await buildApp(stub.db, { logger: spy.logger });
        const res = await localApp.request('/vehiculos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            plate: 'AB-CD-12',
            vehicle_type: vehicleType,
            capacity_kg: 1000,
            ...extraFields,
          }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as {
          vehicle: { unit_category: string; unit_type: string; body_type: string | null };
        };
        expect(body.vehicle.unit_category).toBe(expectedUnitCategory);
        expect(body.vehicle.unit_type).toBe(expectedUnitType);
        expect(body.vehicle.body_type).toBe(expectedBodyType);

        // Condición 1 del PO (fix C1): log estructurado cada vez que la
        // derivación dispara, con vehicle_type origen + unidad derivada +
        // empresa_id + vehiculo_id resultante.
        expect(spy.info).toHaveBeenCalledWith(
          expect.objectContaining({
            vehicleType,
            derivedUnitCategory: expectedUnitCategory,
            derivedUnitType: expectedUnitType,
            derivedBodyType: expectedBodyType,
            empresaId: EMPRESA_ID,
            vehicleId: VEHICLE_ID,
          }),
          expect.stringContaining('derivado'),
        );
      },
    );

    it('POST / con unit_type explícito → la derivación NO dispara (no pisa input explícito)', async () => {
      const spy = buildSpyLogger();
      const stub = makeDbStub({ insertRows: [buildVehicleRow()] });
      const localApp = await buildApp(stub.db, { logger: spy.logger });
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'camion_pequeno',
          unit_type: 'camion_rigido',
          capacity_kg: 3500,
        }),
      });
      expect(res.status).toBe(201);
      // Ningún log de derivación — solo el log normal "vehículo creado".
      const derivationLogCalls = spy.info.mock.calls.filter(([, msg]) =>
        String(msg).includes('derivado'),
      );
      expect(derivationLogCalls).toHaveLength(0);
    });

    // No existe una rama de error/fallback alcanzable en runtime: Zod
    // (`z.enum(vehicleTypes)`) rechaza con 400 CUALQUIER `vehicle_type` que
    // no sea uno de los 9 valores whitelisted ANTES de que el handler llegue
    // a invocar `derivarUnidadDesdeTipoLegacy` — por eso ese helper puede
    // asumir (y documenta vía el guard `_exhaustive: never`) que jamás
    // recibe un valor fuera de los 9 mapeados. Este test confirma la mitad
    // del contrato que sí es observable desde afuera: el 400 en el boundary.
    it('POST / vehicle_type fuera del enum → 400 (Zod bloquea antes de derivar, no hay rama de error en la derivación)', async () => {
      const stub = makeDbStub({});
      const localApp = await buildApp(stub.db);
      const res = await localApp.request('/vehiculos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plate: 'AB-CD-12',
          vehicle_type: 'tracto_inventado',
          capacity_kg: 1000,
        }),
      });
      expect(res.status).toBe(400);
    });
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
      // Default `tieneSensorTemperatura: true` (overridable por-row) para que los
      // tests de temperatura preexistentes expongan el dato como antes; los tests
      // de gating pasan `false` explícito.
      const vehicleRows = opts.vehicleRows.map((r) => ({ tieneSensorTemperatura: true, ...r }));
      const limitFn = vi.fn().mockResolvedValue(vehicleRows);
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
        temperatura_sensor_sospechoso: boolean;
        can_speed_kmh: number | null;
        rpm: number | null;
        fuel_pct: number | null;
        temperatura_ambiente_c: number | null;
      };
    }

    const puntoTemp = (raw72: number, i = 0) => ({
      timestamp_device: new Date(`2026-07-06T10:00:${String(i).padStart(2, '0')}Z`),
      timestamp_received_at: new Date(`2026-07-06T10:00:${String(i).padStart(2, '0')}Z`),
      longitude: '-71.2519',
      latitude: '-29.9027',
      altitude_m: 30,
      angle_deg: 90,
      satellites: 11,
      speed_kmh: 0,
      priority: 1,
      io_data: { '72': raw72 },
    });

    it('sin auth → 401', async () => {
      const stub = makeUbicacionStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db, { role: null });
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(401);
    });

    it('GATING: flag=false + crudo IO 72 = 0 → temperatura_c null (0°C no se infiere del valor)', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
            tieneSensorTemperatura: false, // ← sin sonda cableada
          },
        ],
        pointRows: [puntoTemp(0)],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBeNull();
      expect(body.ubicacion.temperatura_registrada_en).toBeNull();
      expect(body.ubicacion.temperatura_sensor_sospechoso).toBe(false);
    });

    it('SANITY: flag=true + IO 72 constante 0 → temperatura_c 0.0 (válido) + sospechoso=true', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'ABCD12',
            teltonikaImei: '999000000000875',
            teltonikaImeiEspejo: null,
            // flag defaultea true
          },
        ],
        // 15 pings, todos IO 72 = 0 → varianza cero.
        pointRows: Array.from({ length: 15 }, (_, i) => puntoTemp(0, i)),
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_c).toBe(0); // 0°C NO se nulea
      expect(body.ubicacion.temperatura_sensor_sospechoso).toBe(true);
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

    it('Teltonika propio con CAN (motor encendido) → can_speed_kmh + rpm + fuel_pct, temperatura coexiste', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'PLFL57',
            teltonikaImei: '860693084796730',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-20T20:31:58Z'),
            timestamp_received_at: new Date('2026-07-20T20:31:59Z'),
            longitude: '-70.6693',
            latitude: '-33.4489',
            altitude_m: 500,
            angle_deg: 90,
            satellites: 10,
            speed_kmh: 0,
            priority: 0,
            // io_data real PLFL57 con CAN: 81 speed, 85 RPM, 89 fuel%, 84 fuel L (no expuesto), 72 temp.
            io_data: { '72': 0, '81': 0, '84': 520, '85': 852, '89': 26 },
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.can_speed_kmh).toBe(0);
      expect(body.ubicacion.rpm).toBe(852);
      expect(body.ubicacion.fuel_pct).toBe(26);
      // regresión: temperatura (IO 72 = 0 → 0.0°C) sigue en el DTO.
      expect(body.ubicacion.temperatura_c).toBe(0);
    });

    it('Teltonika propio SIN CAN (motor apagado) → can_speed_kmh/rpm/fuel_pct null', async () => {
      const stub = makeUbicacionStub({
        vehicleRows: [
          {
            id: VEHICLE_ID,
            plate: 'PLFL57',
            teltonikaImei: '860693084796730',
            teltonikaImeiEspejo: null,
          },
        ],
        pointRows: [
          {
            timestamp_device: new Date('2026-07-21T15:38:13Z'),
            timestamp_received_at: new Date('2026-07-21T15:38:14Z'),
            longitude: '-70.6693',
            latitude: '-33.4489',
            altitude_m: 500,
            angle_deg: 90,
            satellites: 10,
            speed_kmh: 0,
            priority: 0,
            io_data: { '16': 972232, '66': 25200, '239': 0 }, // solo I/O permanente, sin CAN
          },
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.can_speed_kmh).toBeNull();
      expect(body.ubicacion.rpm).toBeNull();
      expect(body.ubicacion.fuel_pct).toBeNull();
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

    it('clima: obtenerClima inyectado → temperatura_ambiente_c en el DTO (lat/lng del punto)', async () => {
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
            longitude: '-70.6600',
            latitude: '-33.4400',
            altitude_m: 500,
            angle_deg: 90,
            satellites: 10,
            speed_kmh: 0,
            priority: 1,
            io_data: {},
          },
        ],
      });
      const obtenerClima = vi.fn().mockResolvedValue(17.5);
      const app = await buildApp(stub.db, { obtenerClima });
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_ambiente_c).toBeCloseTo(17.5, 5);
      expect(obtenerClima).toHaveBeenCalledWith(-33.44, -70.66);
    });

    it('clima OFF (sin obtenerClima ni weatherProjectId) → temperatura_ambiente_c null', async () => {
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
            longitude: '-70.6600',
            latitude: '-33.4400',
            altitude_m: 500,
            angle_deg: 90,
            satellites: 10,
            speed_kmh: 0,
            priority: 1,
            io_data: {},
          },
        ],
      });
      const app = await buildApp(stub.db); // feature off
      const res = await app.request(`/vehiculos/${VEHICLE_ID}/ubicacion`);
      const body = (await res.json()) as UbicacionBody;
      expect(body.ubicacion.temperatura_ambiente_c).toBeNull();
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

  // ---------------------------------------------------------------------
  // PATCH /:id/dispositivo — IMEI self-service (W2, hito 2 CORFO).
  //
  // A diferencia de makeDbStub (chains directos usados por el resto de este
  // archivo), este endpoint corre TODA su lógica dentro de
  // `db.transaction(async (tx) => {...})` (mismo patrón que
  // admin-dispositivos.ts). El stub de abajo expone un `tx` con
  // select/update respaldados por colas que se consumen en el ORDEN EXACTO
  // en que el handler las invoca — documentado en el comentario de cada
  // test. Correctitud de las cláusulas WHERE reales (p.ej. que el UPDATE de
  // "reemplazado" realmente filtre por status='aprobado' AND
  // assignedToVehicleId=vehiculo) queda fuera de este nivel de test (no hay
  // Postgres real acá); eso es responsabilidad de un test de integración
  // futuro si se prioriza.
  // ---------------------------------------------------------------------
  describe('PATCH /:id/dispositivo — IMEI self-service (W2)', () => {
    const VALID_IMEI = '356307042441013';

    function makeDeviceTxStub(opts: {
      selects?: Array<Record<string, unknown>[]>;
      updates?: Array<Record<string, unknown>[] | { code: string }>;
    }) {
      let selectIdx = 0;
      let updateIdx = 0;

      const selectFn = vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve(opts.selects?.[selectIdx++] ?? [])),
          })),
        })),
      }));

      const updateFn = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => {
              const result = opts.updates?.[updateIdx++];
              if (result && !Array.isArray(result)) {
                return Promise.reject(result);
              }
              return Promise.resolve(result ?? []);
            }),
          })),
        })),
      }));

      const tx = { select: selectFn, update: updateFn };
      const transactionFn = vi.fn((cb: (tx: typeof tx) => unknown) => cb(tx));

      return {
        db: { transaction: transactionFn } as unknown as Parameters<
          typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
        >[0]['db'],
        spies: { selectFn, updateFn, transactionFn },
      };
    }

    function patchDispositivo(
      db: Parameters<typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes>[0]['db'],
      body: Record<string, unknown>,
      opts: { role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null } = {
        role: 'dueno',
      },
    ) {
      return buildApp(db, opts).then((app) =>
        app.request(`/vehiculos/${VEHICLE_ID}/dispositivo`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    }

    it.each([
      ['14 dígitos', '3563070424410'],
      ['con letras', '35630704244101A'],
      ['vacío', ''],
    ])('formato de IMEI inválido (%s) → 400', async (_label, imei) => {
      const stub = makeDeviceTxStub({});
      const res = await patchDispositivo(stub.db, { teltonika_imei: imei });
      expect(res.status).toBe(400);
      expect(stub.spies.transactionFn).not.toHaveBeenCalled();
    });

    it('sin campo teltonika_imei en el body → 400', async () => {
      const stub = makeDeviceTxStub({});
      const res = await patchDispositivo(stub.db, {});
      expect(res.status).toBe(400);
    });

    it('rol sin permiso (despachador) → 403', async () => {
      const stub = makeDeviceTxStub({});
      const res = await patchDispositivo(
        stub.db,
        { teltonika_imei: VALID_IMEI },
        { role: 'despachador' },
      );
      expect(res.status).toBe(403);
      expect(stub.spies.transactionFn).not.toHaveBeenCalled();
    });

    it('IDOR cross-tenant: vehículo no pertenece a la empresa activa → 404 (NO 403)', async () => {
      // select #1 (ownership id+empresaId) no matchea → [].
      const stub = makeDeviceTxStub({ selects: [[]] });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('vehicle_not_found');
    });

    it('vehículo con espejo activo + IMEI propio nuevo → 422 imei_espejo_activo', async () => {
      // select #1: vehiculo con teltonika_imei_espejo seteado.
      const stub = makeDeviceTxStub({
        selects: [
          [
            {
              id: VEHICLE_ID,
              teltonikaImei: null,
              teltonikaImeiEspejo: '999999999999999',
              plate: 'ABCD12',
            },
          ],
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('imei_espejo_activo');
    });

    it('IMEI ya en uso (23505 en el UPDATE) → 409 imei_en_uso, mensaje neutro', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [], // select #2: pendingDevices sin row para el IMEI nuevo
        ],
        updates: [{ code: '23505' }], // update #1: vehiculo → rechazado por UNIQUE
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe('imei_en_uso');
      expect(JSON.stringify(body)).not.toMatch(/empresa|patente|ABCD12/i);
    });

    it('pending aprobado en OTRO vehículo → 409 imei_en_uso (coherencia UNIQUE, sin gastar el UPDATE)', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-5',
              imei: VALID_IMEI,
              status: 'aprobado',
              notes: null,
              updatedAt: new Date('2026-05-01T00:00:00Z'),
              assignedToVehicleId: 'otro-vehiculo-uuid',
            },
          ],
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('imei_en_uso');
      expect(stub.spies.updateFn).not.toHaveBeenCalled();
    });

    it('IMEI rechazado sin confirmar_reasociacion → 409 imei_rechazado con rechazado_en/motivo', async () => {
      const rechazadoEn = new Date('2026-06-01T12:00:00Z');
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-1',
              imei: VALID_IMEI,
              status: 'rechazado',
              notes: 'device de prueba, no instalado',
              updatedAt: rechazadoEn,
              assignedToVehicleId: null,
            },
          ],
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; rechazado_en: string; motivo: string };
      expect(body.code).toBe('imei_rechazado');
      expect(body.motivo).toBe('device de prueba, no instalado');
      expect(body.rechazado_en).toBe(rechazadoEn.toISOString());
      expect(stub.spies.updateFn).not.toHaveBeenCalled();
    });

    it('IMEI rechazado CON confirmar_reasociacion:true → 200, reasociado_desde=rechazado', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-1',
              imei: VALID_IMEI,
              status: 'rechazado',
              notes: 'motivo',
              updatedAt: new Date('2026-06-01T12:00:00Z'),
              assignedToVehicleId: null,
            },
          ],
        ],
        updates: [
          [buildVehicleRow({ teltonikaImei: VALID_IMEI })], // update #1: vehiculo
          [{ id: 'pd-1' }], // update #2: pending → aprobado (override)
        ],
      });
      const res = await patchDispositivo(stub.db, {
        teltonika_imei: VALID_IMEI,
        confirmar_reasociacion: true,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        reconciliacion: string;
        reasociado_desde: string;
        reemplazado_anterior: boolean;
      };
      expect(body.reconciliacion).toBe('reaprobado_desde_rechazado');
      expect(body.reasociado_desde).toBe('rechazado');
      expect(body.reemplazado_anterior).toBe(false);
    });

    it('asociar con pending "pendiente" → 200, reconciliacion=aprobado', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-2',
              imei: VALID_IMEI,
              status: 'pendiente',
              notes: null,
              updatedAt: new Date(),
              assignedToVehicleId: null,
            },
          ],
        ],
        updates: [[buildVehicleRow({ teltonikaImei: VALID_IMEI })], [{ id: 'pd-2' }]],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reconciliacion: string; reemplazado_anterior: boolean };
      expect(body.reconciliacion).toBe('aprobado');
      expect(body.reemplazado_anterior).toBe(false);
    });

    it('asociar con pending "reemplazado" → 200 directo (D3.a, sin confirmar_reasociacion)', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-3',
              imei: VALID_IMEI,
              status: 'reemplazado',
              notes: null,
              updatedAt: new Date(),
              assignedToVehicleId: 'algun-vehiculo-anterior',
            },
          ],
        ],
        updates: [[buildVehicleRow({ teltonikaImei: VALID_IMEI })], [{ id: 'pd-3' }]],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reconciliacion: string };
      expect(body.reconciliacion).toBe('aprobado');
    });

    // -----------------------------------------------------------------
    // TOCTOU (finding 1, revisión W2a): el UPDATE de reconciliación de Y
    // (pendiente/reemplazado → aprobado) no llevaba CAS sobre el status
    // leído en la SELECT previa. Race concreta: mientras esta tx corre, un
    // admin de OTRA empresa (D2b: el rechazo NO es tenant-scoped) rechaza
    // el mismo pending vía `/admin/dispositivos-pendientes/:id/rechazar`.
    // Sin CAS, el UPDATE de esta tx sobreescribiría igual a 'aprobado' sin
    // pasar por el 409 `imei_rechazado` — "nunca silencioso" violado. Con
    // CAS, el UPDATE pierde la carrera (0 filas), la tx aborta (throw) y el
    // handler responde con el estado FRESCO re-leído.
    // -----------------------------------------------------------------
    it('TOCTOU: el CAS de reconciliación de Y pierde la carrera contra un reject externo → 409 imei_rechazado, sin persistir el IMEI', async () => {
      const rechazadoEnFresco = new Date('2026-07-06T15:00:00Z');
      const stub = makeDeviceTxStub({
        selects: [
          // select #1: vehículo (sin IMEI previo).
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          // select #2: pending del IMEI Y, leído como 'pendiente' — decide
          // entrar a la rama pendiente/reemplazado.
          [
            {
              id: 'pd-race',
              imei: VALID_IMEI,
              status: 'pendiente',
              notes: null,
              updatedAt: new Date('2026-07-06T14:00:00Z'),
              assignedToVehicleId: null,
            },
          ],
          // select #3: re-lectura fresca tras el CAS fallido — el pending
          // fue rechazado por el admin externo ENTRE el select #2 y el
          // UPDATE con CAS.
          [
            {
              status: 'rechazado',
              notes: 'rechazado durante la carrera',
              updatedAt: rechazadoEnFresco,
            },
          ],
        ],
        updates: [
          // update #1: vehiculo.teltonika_imei — "éxito aparente" (el stub
          // no modela rollback; en Postgres real este UPDATE sí se revierte
          // porque el throw más abajo aborta la tx completa).
          [buildVehicleRow({ teltonikaImei: VALID_IMEI })],
          // update #2: CAS de reconciliación de Y → 0 filas (perdió la
          // carrera: el WHERE ya no matchea porque el status cambió).
          [],
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; rechazado_en: string; motivo: string };
      expect(body.code).toBe('imei_rechazado');
      expect(body.motivo).toBe('rechazado durante la carrera');
      expect(body.rechazado_en).toBe(rechazadoEnFresco.toISOString());
      // No se llegó a la respuesta 200: sin `vehicle` en el body pese a que
      // el UPDATE de `vehicles` había "aparentado" tener éxito en el stub —
      // evidencia (a este nivel de test) de que la tx abortó en vez de
      // confirmar el cambio de IMEI.
      expect(body).not.toHaveProperty('vehicle');
      // Solo 2 updates: el del vehículo + el CAS fallido. La rama de éxito
      // habría hecho un 2do update de pendingDevices con datos distintos
      // (aprobado/assignedToVehicleId) que acá nunca se alcanza porque el
      // throw corta el flujo antes de cualquier otro write.
      expect(stub.spies.updateFn).toHaveBeenCalledTimes(2);
    });

    it('TOCTOU: el CAS de reconciliación de Y pierde la carrera y el estado fresco NO es "rechazado" → 409 de conflicto genérico', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [
            {
              id: 'pd-race-2',
              imei: VALID_IMEI,
              status: 'reemplazado',
              notes: null,
              updatedAt: new Date('2026-07-06T14:00:00Z'),
              assignedToVehicleId: 'otro-vehiculo-anterior',
            },
          ],
          // re-lectura fresca: otro PATCH concurrente ya lo dejó 'aprobado'
          // en OTRO vehículo — ni siquiera pasó por 'rechazado'.
          [{ status: 'aprobado', notes: null, updatedAt: new Date('2026-07-06T14:30:00Z') }],
        ],
        updates: [[buildVehicleRow({ teltonikaImei: VALID_IMEI })], []],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string; status: string };
      expect(body.code).toBe('pending_device_conflict');
      expect(body.status).toBe('aprobado');
      expect(body).not.toHaveProperty('vehicle');
    });

    it('cambiar X→Y: X pasa a reemplazado, Y se reconcilia (pendiente→aprobado)', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [
            {
              id: VEHICLE_ID,
              teltonikaImei: '111111111111111',
              teltonikaImeiEspejo: null,
              plate: 'ABCD12',
            },
          ],
          [
            {
              id: 'pd-4',
              imei: '222222222222222',
              status: 'pendiente',
              notes: null,
              updatedAt: new Date(),
              assignedToVehicleId: null,
            },
          ],
        ],
        updates: [
          [buildVehicleRow({ teltonikaImei: '222222222222222' })], // update #1: vehiculo
          [{ id: 'pd-old' }], // update #2: X → reemplazado
          [{ id: 'pd-4' }], // update #3: Y → aprobado
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: '222222222222222' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reconciliacion: string; reemplazado_anterior: boolean };
      expect(body.reconciliacion).toBe('aprobado');
      expect(body.reemplazado_anterior).toBe(true);
    });

    it('desasociar (null): X pasa a reemplazado, reconciliacion=null', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [
            {
              id: VEHICLE_ID,
              teltonikaImei: '111111111111111',
              teltonikaImeiEspejo: null,
              plate: 'ABCD12',
            },
          ],
        ],
        updates: [
          [buildVehicleRow({ teltonikaImei: null })], // update #1: vehiculo
          [{ id: 'pd-old' }], // update #2: X → reemplazado
        ],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: null });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        reconciliacion: string | null;
        reemplazado_anterior: boolean;
      };
      expect(body.reconciliacion).toBeNull();
      expect(body.reemplazado_anterior).toBe(true);
    });

    it('asociar IMEI sin row en pending → reconciliacion=sin_registro', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [{ id: VEHICLE_ID, teltonikaImei: null, teltonikaImeiEspejo: null, plate: 'ABCD12' }],
          [], // select #2: sin pending row
        ],
        updates: [[buildVehicleRow({ teltonikaImei: VALID_IMEI })]],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reconciliacion: string; reemplazado_anterior: boolean };
      expect(body.reconciliacion).toBe('sin_registro');
      expect(body.reemplazado_anterior).toBe(false);
    });

    it('pending "aprobado" YA asignado a ESTE MISMO vehículo (PATCH idempotente: reenviar el mismo IMEI) → 200, reconciliacion=aprobado, sin update de pendingDevices', async () => {
      const stub = makeDeviceTxStub({
        selects: [
          [
            {
              id: VEHICLE_ID,
              teltonikaImei: VALID_IMEI,
              teltonikaImeiEspejo: null,
              plate: 'ABCD12',
            },
          ],
          [
            {
              id: 'pd-6',
              imei: VALID_IMEI,
              status: 'aprobado',
              notes: null,
              updatedAt: new Date('2026-06-01T00:00:00Z'),
              assignedToVehicleId: VEHICLE_ID,
            },
          ],
        ],
        updates: [[buildVehicleRow({ teltonikaImei: VALID_IMEI })]],
      });
      const res = await patchDispositivo(stub.db, { teltonika_imei: VALID_IMEI });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reconciliacion: string; reemplazado_anterior: boolean };
      expect(body.reconciliacion).toBe('aprobado');
      expect(body.reemplazado_anterior).toBe(false);
      // Rama idempotente (else final): nada que reconciliar — un solo
      // update (el del vehículo), CERO updates de pendingDevices.
      expect(stub.spies.updateFn).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/traza — historial de recorrido del vehículo (capa 2).
  // 2 selects: vehículo (.limit) + traza (.orderBy terminal, sin .limit).
  // ---------------------------------------------------------------------
  describe('GET /:id/traza (historial de vehículo, capa 2)', () => {
    function makeTrazaStub(opts: {
      vehicleRows: Record<string, unknown>[];
      pointRows: Record<string, unknown>[];
    }) {
      const limitFn = vi.fn().mockResolvedValue(opts.vehicleRows); // vehículo .limit(1)
      const orderByFn = vi.fn().mockResolvedValue(opts.pointRows); // traza .orderBy() terminal
      const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
      const fromFn = vi.fn(() => ({ where: whereFn }));
      const selectFn = vi.fn(() => ({ from: fromFn }));
      return {
        db: { select: selectFn } as unknown as Parameters<
          typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
        >[0]['db'],
        spies: { selectFn, orderByFn, limitFn },
      };
    }

    const vehicleRow = { id: VEHICLE_ID, plate: 'PLFL57' };
    const desde = '2026-07-14T00:00:00Z';
    const hasta = '2026-07-22T00:00:00Z';
    const url = (extra = '') =>
      `/vehiculos/${VEHICLE_ID}/traza?desde=${encodeURIComponent(desde)}&hasta=${encodeURIComponent(hasta)}${extra}`;
    const pt = (
      iso: string,
      lat: string,
      lng: string,
      io: Record<string, number> = {},
      speed: number | null = 40,
    ) => ({
      ts: new Date(iso),
      lat,
      lng,
      speed,
      io,
    });

    interface TrazaBody {
      plate: string;
      puntos: Array<{ t: string; lat: number; lng: number }>;
      puntos_total: number;
      puntos_devueltos: number;
      resumen: {
        distancia_km: number;
        duracion_min: number;
        litros_consumidos: number | null;
        km_can: number | null;
      };
    }

    it('sin auth → 401', async () => {
      const stub = makeTrazaStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db, { role: null });
      expect((await app.request(url())).status).toBe(401);
    });

    it('vehículo no encontrado → 404', async () => {
      const stub = makeTrazaStub({ vehicleRows: [], pointRows: [] });
      const app = await buildApp(stub.db);
      expect((await app.request(url())).status).toBe(404);
    });

    it('rango inválido (hasta <= desde) → 400', async () => {
      const stub = makeTrazaStub({ vehicleRows: [vehicleRow], pointRows: [] });
      const app = await buildApp(stub.db);
      const res = await app.request(
        `/vehiculos/${VEHICLE_ID}/traza?desde=${encodeURIComponent(hasta)}&hasta=${encodeURIComponent(desde)}`,
      );
      expect(res.status).toBe(400);
    });

    it('con telemetría + CAN → traza no vacía + resumen con litros/km del Δ', async () => {
      const stub = makeTrazaStub({
        vehicleRows: [vehicleRow],
        pointRows: [
          pt('2026-07-14T10:00:00Z', '-33.4000', '-70.6000', { '83': 637270, '87': 714023430 }),
          pt('2026-07-14T10:00:30Z', '-33.4050', '-70.6100', {}), // +30s, sin CAN, en marcha
          pt('2026-07-14T10:00:55Z', '-33.5000', '-70.6200', { '83': 641185, '87': 715017215 }), // +25s
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(url());
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrazaBody;
      expect(body.plate).toBe('PLFL57');
      expect(body.puntos.length).toBeGreaterThan(0);
      expect(body.puntos_total).toBe(3);
      expect(body.resumen.litros_consumidos).toBeCloseTo(391.5, 1); // (641185-637270)×0.1
      expect(body.resumen.km_can).toBeCloseTo(993.785, 2); // (715017215-714023430)/1000
      expect(body.resumen.distancia_km).toBeGreaterThan(0);
      expect(body.resumen.duracion_min).toBeGreaterThan(0); // 55s en marcha
    });

    it('duración = movimiento (no span): excluye una parada larga', async () => {
      const stub = makeTrazaStub({
        vehicleRows: [vehicleRow],
        pointRows: [
          pt('2026-07-15T12:00:00Z', '-33.4000', '-70.6000', {}, 40),
          pt('2026-07-15T12:01:00Z', '-33.4100', '-70.6000', {}, 40), // [0→60] marcha
          pt('2026-07-15T12:02:00Z', '-33.4200', '-70.6000', {}, 0), // [60→120] frena → cuenta
          pt('2026-07-15T12:06:00Z', '-33.4200', '-70.6000', {}, 0), // [120→360] 4min parado → NO
          pt('2026-07-15T12:07:00Z', '-33.4300', '-70.6000', {}, 40), // [360→420] arranca → cuenta
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(url());
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrazaBody;
      // span = 7 min; movimiento = 3 tramos × 60s = 3 min.
      expect(body.resumen.duracion_min).toBeCloseTo(3, 5);
      expect(body.resumen.duracion_min).toBeLessThan(7);
    });

    it('sin telemetría → puntos [], resumen en cero/null, no rompe', async () => {
      const stub = makeTrazaStub({ vehicleRows: [vehicleRow], pointRows: [] });
      const app = await buildApp(stub.db);
      const res = await app.request(url());
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrazaBody;
      expect(body.puntos).toEqual([]);
      expect(body.puntos_total).toBe(0);
      expect(body.resumen.distancia_km).toBe(0);
      expect(body.resumen.litros_consumidos).toBeNull();
      expect(body.resumen.km_can).toBeNull();
    });

    it('downsampling: puntos_devueltos ≤ maxPuntos y puntos_total = crudos', async () => {
      const many = Array.from({ length: 50 }, (_, i) =>
        pt(
          new Date(Date.UTC(2026, 6, 15, 12, 0, i)).toISOString(),
          `-33.${400 + i}`,
          '-70.6000',
          {},
        ),
      );
      const stub = makeTrazaStub({ vehicleRows: [vehicleRow], pointRows: many });
      const app = await buildApp(stub.db);
      const res = await app.request(url('&maxPuntos=10'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as TrazaBody;
      expect(body.puntos_total).toBe(50);
      expect(body.puntos_devueltos).toBeLessThanOrEqual(10);
      expect(body.puntos.length).toBeLessThanOrEqual(10);
    });
  });
});
