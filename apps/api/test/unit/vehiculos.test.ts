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
  app.route('/vehiculos', createVehiculosRoutes({ db, logger: opts.logger ?? noopLogger }));
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
});
