import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyActivationPin } from '../../src/services/activation-pin.js';

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
  typeof import('../../src/routes/conductores.js').createConductoresRoutes
>[0]['logger'];

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const CONDUCTOR_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const VALID_RUT = '11.111.111-1';

interface ConductorListRow {
  id: string;
  user_id: string;
  empresa_id: string;
  license_class: string;
  license_number: string;
  license_expiry: Date | string;
  is_extranjero: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  user_full_name: string;
  user_rut: string;
  user_email: string;
  user_phone: string | null;
  user_firebase_uid: string;
}

function buildConductorListRow(overrides: Partial<ConductorListRow> = {}): ConductorListRow {
  return {
    id: CONDUCTOR_ID,
    user_id: USER_ID,
    empresa_id: EMPRESA_ID,
    license_class: 'A5',
    license_number: 'LIC-12345',
    license_expiry: new Date('2027-12-31T00:00:00Z'),
    is_extranjero: false,
    status: 'activo',
    created_at: new Date('2026-05-10T22:00:00Z'),
    updated_at: new Date('2026-05-10T22:00:00Z'),
    deleted_at: null,
    user_full_name: 'Juan Pérez',
    user_rut: VALID_RUT,
    user_email: 'juan@example.com',
    user_phone: '+56912345678',
    user_firebase_uid: 'fb-uid-juan',
    ...overrides,
  };
}

/**
 * Stub fluent del DB. Soporta: select.from.innerJoin.where.orderBy(...),
 * select.from.innerJoin.where.limit(...), select.from.where.limit(...),
 * insert.values.returning(...), update.set.where.returning(...),
 * transaction(fn).
 */
function makeDbStub(opts: {
  selectQueueRows?: Record<string, unknown>[][];
  insertReturning?: Record<string, unknown>[][];
  updateReturning?: Record<string, unknown>[][];
  selectError?: Error;
  insertError?: unknown;
  updateError?: unknown;
}) {
  const selectQueue = [...(opts.selectQueueRows ?? [])];
  const insertQueue = [...(opts.insertReturning ?? [])];
  const updateQueue = [...(opts.updateReturning ?? [])];

  const nextSelect = () => selectQueue.shift() ?? [];
  const nextInsert = () => insertQueue.shift() ?? [];
  const nextUpdate = () => updateQueue.shift() ?? [];

  function makeSelectChain() {
    const finalize = () => Promise.resolve(nextSelect());
    const orderBy = vi.fn(finalize);
    const limit = vi.fn(finalize);
    const where = vi.fn(() => ({
      orderBy,
      limit,
      then(
        onFulfilled: (rows: Record<string, unknown>[]) => unknown,
        onRejected?: (err: unknown) => unknown,
      ) {
        return Promise.resolve(nextSelect()).then(onFulfilled, onRejected);
      },
    }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ where, innerJoin }));
    return vi.fn(() => ({ from }));
  }

  function makeInsertChain() {
    const returning = vi.fn(() => {
      if (opts.insertError) {
        return Promise.reject(opts.insertError);
      }
      return Promise.resolve(nextInsert());
    });
    const values = vi.fn(() => ({ returning }));
    return vi.fn(() => ({ values }));
  }

  function makeUpdateChain() {
    const returning = vi.fn(() => {
      if (opts.updateError) {
        return Promise.reject(opts.updateError);
      }
      return Promise.resolve(nextUpdate());
    });
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    return vi.fn(() => ({ set }));
  }

  const select = makeSelectChain();
  const insert = makeInsertChain();
  const update = makeUpdateChain();

  // transaction(fn): pasa un "tx" con los mismos métodos.
  const txClient = { select, insert, update };
  const transaction = vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => {
    return await fn(txClient);
  });

  return {
    db: { select, insert, update, transaction } as unknown as Parameters<
      typeof import('../../src/routes/conductores.js').createConductoresRoutes
    >[0]['db'],
    spies: { select, insert, update, transaction },
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/conductores.js').createConductoresRoutes>[0]['db'],
  opts: {
    role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null;
    firebaseAuth?: Parameters<
      typeof import('../../src/routes/conductores.js').createConductoresRoutes
    >[0]['firebaseAuth'];
    emailSender?: Parameters<
      typeof import('../../src/routes/conductores.js').createConductoresRoutes
    >[0]['emailSender'];
    logger?: Parameters<
      typeof import('../../src/routes/conductores.js').createConductoresRoutes
    >[0]['logger'];
    whatsappClient?: Parameters<
      typeof import('../../src/routes/conductores.js').createConductoresRoutes
    >[0]['whatsappClient'];
    activacionContentSid?: string;
  } = {
    role: 'dueno',
  },
) {
  const { createConductoresRoutes } = await import('../../src/routes/conductores.js');
  const role = opts.role === undefined ? 'dueno' : opts.role;
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (role === null) {
      await next();
      return;
    }
    c.set('userContext', {
      user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm-1', role },
        empresa: { id: EMPRESA_ID, legalName: 'Test SA' },
      },
    });
    await next();
  });
  app.route(
    '/conductores',
    createConductoresRoutes({
      db,
      logger: opts.logger ?? noopLogger,
      ...(opts.firebaseAuth ? { firebaseAuth: opts.firebaseAuth } : {}),
      ...(opts.emailSender ? { emailSender: opts.emailSender } : {}),
      ...(opts.whatsappClient ? { whatsappClient: opts.whatsappClient } : {}),
      ...(opts.activacionContentSid ? { activacionContentSid: opts.activacionContentSid } : {}),
    }),
  );
  return app;
}

describe('conductores routes', () => {
  describe('GET /', () => {
    it('sin auth → 401', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db, { role: null });
      const res = await app.request('/conductores');
      expect(res.status).toBe(401);
    });

    it('devuelve lista con datos del user enlazado + flag is_pending', async () => {
      const stub = makeDbStub({
        selectQueueRows: [[buildConductorListRow()]],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        conductores: Array<{
          id: string;
          license_expiry: string;
          user: { full_name: string; rut: string; is_pending: boolean };
        }>;
      };
      expect(body.conductores).toHaveLength(1);
      const c0 = body.conductores[0];
      expect(c0?.license_expiry).toBe('2027-12-31');
      expect(c0?.user.full_name).toBe('Juan Pérez');
      expect(c0?.user.rut).toBe(VALID_RUT);
      expect(c0?.user.is_pending).toBe(false);
    });

    it('user con firebase_uid placeholder → is_pending=true', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          [buildConductorListRow({ user_firebase_uid: 'pending-rut:11.111.111-1' })],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores');
      const body = (await res.json()) as {
        conductores: Array<{ user: { is_pending: boolean } }>;
      };
      expect(body.conductores[0]?.user.is_pending).toBe(true);
    });
  });

  describe('POST /', () => {
    it('rol conductor (no write) → 403', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db, { role: 'conductor' });
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio — es su canal con
          // la plataforma.
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(403);
    });

    it('RUT inválido (dígito verificador malo) → 400 rut_invalido', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: '11.111.111-9', // dígito verificador incorrecto
          full_name: 'Juan',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio — es su canal con la plataforma.
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('rut_invalido');
    });

    it('fijo +56221234567 en el alta → 400 y no crea ni reactiva', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan',
          phone: '+56221234567',
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('telefono_invalido');
      expect(body.message).toBe('Ingresa un teléfono válido (+569...)');
      expect(stub.spies.insert).not.toHaveBeenCalled();
      expect(stub.spies.update).not.toHaveBeenCalled();
    });

    it('body inválido (sin license_class) → 400 zod', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio — es su canal con
          // la plataforma.
          email: 'juan.conductor@empresa.cl',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(400);
    });

    it('user existente sin conductor → enlaza + crea conductor 201', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          // lookup user por RUT — existe
          [{ id: USER_ID, fullName: 'Juan Pérez', firebaseUid: 'fb-uid-juan' }],
          // lookup conductor existente — no hay
          [],
        ],
        insertReturning: [
          // insert conductor
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'A5',
              licenseNumber: 'LIC-12345',
              licenseExpiry: new Date('2027-12-31T00:00:00Z'),
              isExtranjero: false,
              driverStatus: 'activo',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T22:00:00Z'),
              deletedAt: null,
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan Pérez',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio.
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-12345',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        conductor: { id: string; license_expiry: string };
        activation_pin?: string;
      };
      expect(body.conductor.id).toBe(CONDUCTOR_ID);
      expect(body.conductor.license_expiry).toBe('2027-12-31');
      // D10: user pre-existente con firebase_uid REAL → no PIN devuelto.
      // El user de este test tiene `fb-uid-juan` (no placeholder).
      expect(body.activation_pin).toBeUndefined();
    });

    it('D10 — user con firebase_uid placeholder → SÍ devuelve PIN', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          [
            {
              id: USER_ID,
              fullName: 'Juan Pérez',
              firebaseUid: 'pending-rut:11.111.111-1',
            },
          ],
          [],
        ],
        insertReturning: [
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'A5',
              licenseNumber: 'LIC-12345',
              licenseExpiry: new Date('2027-12-31T00:00:00Z'),
              isExtranjero: false,
              driverStatus: 'activo',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T22:00:00Z'),
              deletedAt: null,
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan Pérez',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio.
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-12345',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { activation_pin: string };
      expect(body.activation_pin).toMatch(/^\d{6}$/);
    });

    it('placeholder que ya tiene código no recibe otro PIN', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          [
            {
              id: USER_ID,
              fullName: 'Juan Pérez',
              firebaseUid: 'pending-rut:11.111.111-1',
              claveNumericaHash: null,
              activationPinHash: 'hash-previo',
            },
          ],
          [],
        ],
        insertReturning: [
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'A5',
              licenseNumber: 'LIC-12345',
              licenseExpiry: new Date('2027-12-31T00:00:00Z'),
              isExtranjero: false,
              driverStatus: 'activo',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T22:00:00Z'),
              deletedAt: null,
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan Pérez',
          phone: '+56957790379',
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-12345',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { activation_pin?: string };
      expect(body.activation_pin).toBeUndefined();
    });

    it('user existente con conductor activo → 409 user_already_driver', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          [{ id: USER_ID, fullName: 'Juan Pérez', firebaseUid: 'fb-uid-juan' }],
          [{ id: CONDUCTOR_ID, deletedAt: null }], // ya hay conductor activo
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Juan',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio — es su canal con
          // la plataforma.
          email: 'juan.conductor@empresa.cl',
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('user_already_driver');
    });

    it('user no existente → crea user pending + conductor 201 + retorna PIN', async () => {
      const stub = makeDbStub({
        selectQueueRows: [
          // lookup user — no hay
          [],
        ],
        insertReturning: [
          // insert user
          [{ id: USER_ID }],
          // insert conductor
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'B',
              licenseNumber: 'LIC-NEW',
              licenseExpiry: new Date('2028-06-30T00:00:00Z'),
              isExtranjero: true,
              driverStatus: 'activo',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T22:00:00Z'),
              deletedAt: null,
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request('/conductores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rut: VALID_RUT,
          full_name: 'Nuevo Conductor',
          phone: '+56957790379',
          // Fase B: el email del conductor es obligatorio.
          email: 'conductor@empresa.cl',
          license_class: 'B',
          license_number: 'LIC-NEW',
          license_expiry: '2028-06-30',
          is_extranjero: true,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        conductor: { license_class: string; is_extranjero: boolean };
      };
      expect(body.conductor.license_class).toBe('B');
      expect(body.conductor.is_extranjero).toBe(true);
    });
  });

  describe('PATCH /:id', () => {
    it('rol conductor → 403', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db, { role: 'conductor' });
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspendido' }),
      });
      expect(res.status).toBe(403);
    });

    it('no encontrado → 404', async () => {
      const stub = makeDbStub({
        selectQueueRows: [[]], // verificación inicial: no hay
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspendido' }),
      });
      expect(res.status).toBe(404);
    });

    it('conductor ya eliminado → 410', async () => {
      const stub = makeDbStub({
        selectQueueRows: [[{ id: CONDUCTOR_ID, deletedAt: new Date('2026-05-09T00:00:00Z') }]],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'activo' }),
      });
      expect(res.status).toBe(410);
    });

    it('actualiza status correctamente', async () => {
      const stub = makeDbStub({
        selectQueueRows: [[{ id: CONDUCTOR_ID, deletedAt: null }]],
        updateReturning: [
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'A5',
              licenseNumber: 'LIC-1',
              licenseExpiry: new Date('2027-12-31T00:00:00Z'),
              isExtranjero: false,
              driverStatus: 'suspendido',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T23:00:00Z'),
              deletedAt: null,
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspendido' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { conductor: { status: string } };
      expect(body.conductor.status).toBe('suspendido');
    });
  });

  describe('DELETE /:id', () => {
    it('rol conductor → 403', async () => {
      const stub = makeDbStub({});
      const app = await buildApp(stub.db, { role: 'conductor' });
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(403);
    });

    it('soft delete exitoso', async () => {
      const stub = makeDbStub({
        updateReturning: [
          [
            {
              id: CONDUCTOR_ID,
              userId: USER_ID,
              empresaId: EMPRESA_ID,
              licenseClass: 'A5',
              licenseNumber: 'LIC-1',
              licenseExpiry: new Date('2027-12-31T00:00:00Z'),
              isExtranjero: false,
              driverStatus: 'fuera_servicio',
              createdAt: new Date('2026-05-10T22:00:00Z'),
              updatedAt: new Date('2026-05-10T23:00:00Z'),
              deletedAt: new Date('2026-05-10T23:00:00Z'),
            },
          ],
        ],
      });
      const app = await buildApp(stub.db);
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; conductor_id: string };
      expect(body.ok).toBe(true);
      expect(body.conductor_id).toBe(CONDUCTOR_ID);
    });

    it('no encontrado → 404', async () => {
      const stub = makeDbStub({ updateReturning: [[]] });
      const app = await buildApp(stub.db);
      const res = await app.request(`/conductores/${CONDUCTOR_ID}`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });
});

// ---------------------------------------------------------------------------
// GET /:id — detalle (bug de producción 2026-09-14: 500 en todos los conductores)
// ---------------------------------------------------------------------------
// `licencia_vencimiento` es DATE en la base (migración 0021, a propósito) pero
// el schema Drizzle la declaraba `timestamp`: el driver entrega "2028-09-22",
// Drizzle le pega "+0000" y produce un Date inválido. La lista lo escondía con
// `safeDateString` (devolvía null → nadie veía vencimientos); el detalle hacía
// `.toISOString()` directo → RangeError → 500 en el botón Editar del móvil.
describe('GET /conductores/:id — detalle', () => {
  it('sin auth → 401', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: null });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}`);
    expect(res.status).toBe(401);
  });

  it('con la columna date mapeada como string devuelve license_expiry YYYY-MM-DD', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[{ ...buildConductorListRow(), license_expiry: '2028-09-22' }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conductor: { license_expiry: string | null; user: { rut: string; is_pending: boolean } };
    };
    expect(body.conductor.license_expiry).toBe('2028-09-22');
    expect(body.conductor.user.rut).toBe(VALID_RUT);
  });

  it('REGRESIÓN 2026-09-14: un Date inválido en license_expiry NO rompe el detalle (200 con null, no 500)', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [{ ...buildConductorListRow(), license_expiry: new Date('fecha-corrupta') }],
      ],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conductor: { license_expiry: string | null } };
    expect(body.conductor.license_expiry).toBeNull();
  });

  it('fechas de auditoría inválidas tampoco rompen (created_at/updated_at → null)', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          {
            ...buildConductorListRow(),
            license_expiry: '2028-09-22',
            created_at: new Date('x'),
            updated_at: new Date('x'),
          },
        ],
      ],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conductor: { created_at: string | null } };
    expect(body.conductor.created_at).toBeNull();
  });

  it('fila inexistente → 404 conductor_not_found', async () => {
    const stub = makeDbStub({ selectQueueRows: [[]] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Bug preexistente encontrado en la prueba e2e de la Fase B (2026-07-31)
// ---------------------------------------------------------------------------
// El POST serializaba `license_expiry` con `.toISOString()` directo. Cuando
// node-postgres devuelve la fecha en un formato que produce un Date con tiempo
// NaN, eso lanza RangeError "Invalid time value" y el alta entera se cae con
// 500 — el conductor queda creado en la BD pero el operador ve un error.
//
// El helper `safeIsoString` ya existía en el mismo archivo, con un comentario
// que describe este fallo ("caso real detectado durante el dry-run pre-Corfo");
// el GET lo usaba y el POST no.
describe('POST /conductores — fecha de licencia no rompe la respuesta', () => {
  it('un licenseExpiry inválido devuelve 201 con la fecha en null, no 500', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[], []],
      insertReturning: [
        [{ id: USER_ID }],
        [
          {
            id: CONDUCTOR_ID,
            userId: USER_ID,
            empresaId: EMPRESA_ID,
            licenseClass: 'A5',
            licenseNumber: 'LIC-1',
            // El caso que rompía: Date con tiempo NaN.
            licenseExpiry: new Date('fecha-corrupta'),
            isExtranjero: false,
            driverStatus: 'activo',
            createdAt: new Date('2026-05-10T22:00:00Z'),
            updatedAt: new Date('2026-05-10T22:00:00Z'),
            deletedAt: null,
          },
        ],
      ],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Juan Pérez',
        phone: '+56957790379',
        email: 'juan.conductor@empresa.cl',
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2027-12-31',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { conductor: { license_expiry: string | null } };
    expect(body.conductor.license_expiry).toBeNull();
  });
});

const EMAIL_REAL = 'usuario@example.com';

function filaConductor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conductorId: CONDUCTOR_ID,
    deletedAt: null,
    userId: USER_ID,
    email: 'pending-rut-111111111@boosterchile.invalid',
    fullName: 'Camila Rojas',
    rut: VALID_RUT,
    phone: '+56912345678',
    firebaseUid: 'pending-rut:11.111.111-1',
    claveNumericaHash: null,
    ...overrides,
  };
}

function firebaseSinCuentas() {
  return {
    getUserByEmail: vi.fn(async () => {
      throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    }),
    updateUser: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
  };
}

describe('POST /conductores — email real y único', () => {
  it('rechaza el correo de relleno', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email: 'pending-rut-111111111@boosterchile.invalid',
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(400);
    expect(stub.spies.insert).not.toHaveBeenCalled();
  });

  it.each(['abc', 'a@b', 'a@b.c'])('email %s → 400 y no escribe', async (email) => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email,
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(400);
    expect(stub.spies.insert).not.toHaveBeenCalled();
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('email de otra persona → 409 email_already_registered y no inserta', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[], [{ id: 'otro-usuario' }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email: EMAIL_REAL,
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
    expect(stub.spies.insert).not.toHaveBeenCalled();
  });

  it('carrera de unique (23505 en cause) → 409 email_already_registered', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[], []],
      insertError: Object.assign(new Error('Failed query'), {
        cause: { code: '23505', constraint: 'usuarios_email_unique' },
      }),
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email: EMAIL_REAL,
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
  });

  it('23505 de otro constraint (RUT) → 409 duplicate', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[], []],
      insertError: Object.assign(new Error('Failed query'), {
        code: '23505',
        constraint: 'uq_usuarios_rut',
      }),
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email: EMAIL_REAL,
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate');
  });

  it('reemplazar el relleno de alguien vinculado a otra empresa → 409 sin escribir ni Firebase', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          {
            id: USER_ID,
            fullName: 'Camila Rojas',
            firebaseUid: 'pending-rut:11.111.111-1',
            claveNumericaHash: null,
            activationPinHash: null,
            email: 'pending-rut-111111111@boosterchile.invalid',
          },
        ],
        [],
        [],
        [
          {
            empresaId: '99999999-9999-9999-9999-999999999999',
            role: 'dueno',
            organizacionId: null,
            status: 'activa',
          },
        ],
      ],
    });
    const firebase = firebaseSinCuentas();
    const app = await buildApp(stub.db, { firebaseAuth: firebase });
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        rut: VALID_RUT,
        full_name: 'Camila Rojas',
        phone: '+56957790379',
        email: EMAIL_REAL,
        license_class: 'A5',
        license_number: 'LIC-1',
        license_expiry: '2028-06-28',
      }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('identidad_vinculada');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
    expect(firebase.getUserByEmail).not.toHaveBeenCalled();
  });
});

describe('POST /conductores/:id/email', () => {
  it.each(['abc', 'a@b', 'a@b.c'])('email %s → 400 y no escribe', async (email) => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(res.status).toBe(400);
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
  });

  it.each(['conductor', 'visualizador'] as const)('%s → 403 y no escribe', async (role) => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(403);
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it.each(['dueno', 'admin', 'despachador'] as const)(
    '%s reemplaza el relleno, reenvía el PIN y audita',
    async (role) => {
      const stub = makeDbStub({
        selectQueueRows: [[filaConductor()], []],
        updateReturning: [[{ id: USER_ID }]],
        insertReturning: [[{ id: 'audit-1' }]],
      });
      const send = vi.fn(async () => ({ enviado: true as const, id: 'mail-1' }));
      const info = vi.fn();
      const logger = { ...noopLogger, info, child: () => logger } as unknown as typeof noopLogger;
      const firebase = firebaseSinCuentas();
      const app = await buildApp(stub.db, {
        role,
        firebaseAuth: firebase,
        emailSender: { send },
        logger,
      });
      const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: `  ${EMAIL_REAL.toUpperCase()}  ` }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        email: string;
        invitacion_reenviada: boolean;
        cuenta_activa: boolean;
        activation_pin?: string;
      };
      expect(body.email).toBe(EMAIL_REAL);
      expect(body.invitacion_reenviada).toBe(true);
      expect(body.cuenta_activa).toBe(false);
      expect(body.activation_pin).toMatch(/^\d{6}$/);
      expect(send).toHaveBeenCalledTimes(1);
      const mensaje = send.mock.calls[0]?.[0] as { to: string; text: string };
      expect(mensaje.to).toBe(EMAIL_REAL);
      expect(mensaje.text).toContain(body.activation_pin);
      expect(JSON.stringify(info.mock.calls)).not.toContain(body.activation_pin);
      expect(firebase.updateUser).not.toHaveBeenCalled();
    },
  );

  it('cuenta ya activa: cambia el contacto y no toca Firebase ni la clave', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          filaConductor({
            email: 'viejo@example.com',
            firebaseUid: 'fb-real-uid',
            claveNumericaHash: 'hash-clave',
          }),
        ],
        [],
      ],
      updateReturning: [[{ id: USER_ID }]],
      insertReturning: [[{ id: 'audit-1' }]],
    });
    const firebase = firebaseSinCuentas();
    const app = await buildApp(stub.db, { firebaseAuth: firebase });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitacion_reenviada: boolean; activation_pin?: string };
    expect(body.invitacion_reenviada).toBe(false);
    expect(body.activation_pin).toBeUndefined();
    expect(firebase.getUserByEmail).not.toHaveBeenCalled();
    expect(firebase.updateUser).not.toHaveBeenCalled();
  });

  it('email ya usado por otra persona → 409 y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor()], [{ id: 'otro-usuario' }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('dos cuentas Firebase que ya entraron → 409 y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor()], []],
    });
    const cuentas: Record<
      string,
      { uid: string; email: string; metadata: { lastSignInTime?: string } }
    > = {
      'drivers+111111111@boosterchile.invalid': {
        uid: 'uid-sintetico',
        email: 'drivers+111111111@boosterchile.invalid',
        metadata: { lastSignInTime: 'Mon, 19 Oct 2026 12:00:00 GMT' },
      },
      'pending-rut-111111111@boosterchile.invalid': {
        uid: 'uid-relleno',
        email: 'pending-rut-111111111@boosterchile.invalid',
        metadata: { lastSignInTime: 'Mon, 19 Oct 2026 13:00:00 GMT' },
      },
    };
    const firebase = {
      getUserByEmail: vi.fn(async (email: string) => {
        const encontrado = cuentas[email.toLowerCase()];
        if (!encontrado) {
          throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
        }
        return encontrado;
      }),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
    };
    const app = await buildApp(stub.db, { firebaseAuth: firebase });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('identidad_firebase_en_conflicto');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(firebase.deleteUser).not.toHaveBeenCalled();
  });

  it('conductor de otra empresa → 404', async () => {
    const stub = makeDbStub({ selectQueueRows: [[]] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(404);
  });

  it('conductor retirado → 410', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor({ deletedAt: new Date('2026-05-01T00:00:00Z') })]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(410);
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('carrera de unique (23505 en cause) → 409 email_already_registered', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor()], []],
      updateError: Object.assign(new Error('Failed query'), {
        cause: { code: '23505', constraint: 'usuarios_email_key' },
      }),
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
  });

  it('23505 de otro constraint (firebase_uid) → 409 duplicate', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor()], []],
      updateError: Object.assign(new Error('Failed query'), {
        code: '23505',
        constraint: 'usuarios_firebase_uid_key',
      }),
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('duplicate');
  });

  it.each([
    {
      caso: 'membresía en otra empresa',
      vinculo: {
        empresaId: '99999999-9999-9999-9999-999999999999',
        role: 'conductor',
        organizacionId: null,
        status: 'activa',
      },
    },
    {
      caso: 'rol dueno en esta empresa',
      vinculo: {
        empresaId: EMPRESA_ID,
        role: 'dueno',
        organizacionId: null,
        status: 'activa',
      },
    },
  ])('$caso → 409 identidad_vinculada y no escribe', async ({ vinculo }) => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor()], [], [vinculo]],
    });
    const firebase = firebaseSinCuentas();
    const app = await buildApp(stub.db, { role: 'despachador', firebaseAuth: firebase });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('identidad_vinculada');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(firebase.getUserByEmail).not.toHaveBeenCalled();
  });

  it('solo conductor de esta empresa: la membresía de conductor no bloquea', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [filaConductor()],
        [],
        [
          {
            empresaId: EMPRESA_ID,
            role: 'conductor',
            organizacionId: null,
            status: 'activa',
          },
        ],
      ],
      updateReturning: [[{ id: USER_ID }]],
      insertReturning: [[{ id: 'audit-1' }]],
    });
    const app = await buildApp(stub.db, { firebaseAuth: firebaseSinCuentas() });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: EMAIL_REAL }),
    });
    expect(res.status).toBe(200);
  });
});

function conductorInsertado() {
  return {
    id: CONDUCTOR_ID,
    userId: USER_ID,
    empresaId: EMPRESA_ID,
    licenseClass: 'A5',
    licenseNumber: 'LIC-1',
    licenseExpiry: new Date('2028-06-28T00:00:00Z'),
    isExtranjero: false,
    driverStatus: 'activo',
    createdAt: new Date('2026-05-10T22:00:00Z'),
    updatedAt: new Date('2026-05-10T22:00:00Z'),
    deletedAt: null,
  };
}

function payloadsDeUpdate(update: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const resultado = update.mock.results.find((item) => item.type === 'return');
  const set = (resultado?.value as { set?: ReturnType<typeof vi.fn> } | undefined)?.set;
  if (!set) {
    return [];
  }
  return set.mock.calls.map((call) => (call[0] ?? {}) as Record<string, unknown>);
}

const ALTA_BODY = {
  rut: VALID_RUT,
  full_name: 'Camila Rojas',
  phone: '+56957790379',
  email: EMAIL_REAL,
  license_class: 'A5' as const,
  license_number: 'LIC-1',
  license_expiry: '2028-06-28',
};

describe('POST /conductores — RUT existente guarda phone si estaba vacío', () => {
  it('provisoria sin código y phone null persiste el teléfono del alta', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          {
            id: USER_ID,
            fullName: 'Camila Rojas',
            firebaseUid: 'pending-rut:11.111.111-1',
            claveNumericaHash: null,
            activationPinHash: null,
            email: EMAIL_REAL,
            phone: null,
          },
        ],
        [],
        [],
      ],
      insertReturning: [[conductorInsertado()]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });
    expect(res.status).toBe(201);
    expect(
      payloadsDeUpdate(stub.spies.update).some((payload) => payload.phone === '+56957790379'),
    ).toBe(true);
  });

  it('reemplazo de email de relleno con phone vacío también lo guarda', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          {
            id: USER_ID,
            fullName: 'Camila Rojas',
            firebaseUid: 'pending-rut:11.111.111-1',
            claveNumericaHash: null,
            activationPinHash: null,
            email: 'pending-rut-111111111@boosterchile.invalid',
            phone: '',
          },
        ],
        [],
        [],
        [],
      ],
      insertReturning: [[conductorInsertado()], [{ id: 'audit-1' }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });
    expect(res.status).toBe(201);
    expect(
      payloadsDeUpdate(stub.spies.update).some((payload) => payload.phone === '+56957790379'),
    ).toBe(true);
  });

  it('no pisa un teléfono que el usuario ya tenía', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          {
            id: USER_ID,
            fullName: 'Camila Rojas',
            firebaseUid: 'pending-rut:11.111.111-1',
            claveNumericaHash: null,
            activationPinHash: null,
            email: EMAIL_REAL,
            phone: '+56911111111',
          },
        ],
        [],
        [],
      ],
      insertReturning: [[conductorInsertado()]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });
    expect(res.status).toBe(201);
    expect(payloadsDeUpdate(stub.spies.update).some((payload) => 'phone' in payload)).toBe(false);
  });
});

describe('POST /conductores/:id/telefono', () => {
  const TELEFONO_NUEVO = '+56987654321';

  it.each([
    ['sin reenviar_invitacion', { phone: TELEFONO_NUEVO }],
    ['con reenviar_invitacion: false', { phone: TELEFONO_NUEVO, reenviar_invitacion: false }],
  ])('pendiente %s: guarda el número y conserva el PIN, sin WhatsApp', async (_caso, payload) => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor({ phone: '+56911111111' })]],
      updateReturning: [[{ id: USER_ID }]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM1' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      phone: string;
      invitacion_reenviada: boolean;
      cuenta_activa: boolean;
      activation_pin?: string;
    };
    expect(body.phone).toBe(TELEFONO_NUEVO);
    expect(body.invitacion_reenviada).toBe(false);
    expect(body.cuenta_activa).toBe(false);
    expect(body.activation_pin).toBeUndefined();
    const payloads = payloadsDeUpdate(stub.spies.update);
    expect(payloads.some((p) => p.phone === TELEFONO_NUEVO)).toBe(true);
    expect(payloads.some((p) => 'activationPinHash' in p)).toBe(false);
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('reenviar_invitacion que no es booleano → 400 y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor({ phone: '+56911111111' })]],
      updateReturning: [[{ id: USER_ID }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO, reenviar_invitacion: 'si' }),
    });
    expect(res.status).toBe(400);
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('cuenta activa con reenviar_invitacion: true → solo guarda el número', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [filaConductor({ firebaseUid: 'fb-real-uid', claveNumericaHash: 'hash-clave' })],
      ],
      updateReturning: [[{ id: USER_ID }]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM1' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO, reenviar_invitacion: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitacion_reenviada: boolean; activation_pin?: string };
    expect(body.invitacion_reenviada).toBe(false);
    expect(body.activation_pin).toBeUndefined();
    expect(payloadsDeUpdate(stub.spies.update).some((p) => 'activationPinHash' in p)).toBe(false);
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('pendiente con reenviar_invitacion: true: guarda, regenera el PIN y avisa por WhatsApp', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor({ phone: '+56911111111' })]],
      updateReturning: [[{ id: USER_ID }]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM1' }));
    const info = vi.fn();
    const logger = { ...noopLogger, info, child: () => logger } as unknown as typeof noopLogger;
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
      logger,
    });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO, reenviar_invitacion: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      phone: string;
      email: string;
      invitacion_reenviada: boolean;
      cuenta_activa: boolean;
      activation_pin?: string;
    };
    expect(body.phone).toBe(TELEFONO_NUEVO);
    expect(body.email).toBe('pending-rut-111111111@boosterchile.invalid');
    expect(body.invitacion_reenviada).toBe(true);
    expect(body.cuenta_activa).toBe(false);
    expect(body.activation_pin).toMatch(/^\d{6}$/);
    expect(
      payloadsDeUpdate(stub.spies.update).some((payload) => payload.phone === TELEFONO_NUEVO),
    ).toBe(true);
    expect(sendContent).toHaveBeenCalledTimes(1);
    expect(sendContent.mock.calls[0]?.[0]).toMatchObject({ to: TELEFONO_NUEVO });
    expect(JSON.stringify(info.mock.calls)).not.toContain(body.activation_pin);
  });

  it('persona vinculada a otra empresa → 409 y no cambia el teléfono ni el PIN', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [filaConductor({ phone: '+56911111111' })],
        [
          {
            empresaId: '99999999-9999-9999-9999-999999999999',
            role: 'conductor',
            organizacionId: null,
            status: 'activa',
          },
        ],
      ],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM1' }));
    const app = await buildApp(stub.db, {
      role: 'despachador',
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('identidad_vinculada');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('teléfono inválido → 400 con mensaje claro y no escribe', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '912345678' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('telefono_invalido');
    expect(body.message).toBe('Ingresa un teléfono válido (+569...)');
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('fijo +562 → 400 con el mismo mensaje y no escribe', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '+56212345678' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('telefono_invalido');
    expect(body.message).toBe('Ingresa un teléfono válido (+569...)');
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('conductor de otra empresa → 404', async () => {
    const stub = makeDbStub({ selectQueueRows: [[]] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('conductor_not_found');
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('cuenta ya activa: actualiza el contacto y no reenvía WhatsApp ni PIN', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [filaConductor({ firebaseUid: 'fb-real-uid', claveNumericaHash: 'hash-clave' })],
      ],
      updateReturning: [[{ id: USER_ID }]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM1' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitacion_reenviada: boolean; activation_pin?: string };
    expect(body.invitacion_reenviada).toBe(false);
    expect(body.activation_pin).toBeUndefined();
    expect(sendContent).not.toHaveBeenCalled();
  });

  it.each(['conductor', 'visualizador'] as const)('%s → 403 y no escribe', async (role) => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role });
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO }),
    });
    expect(res.status).toBe(403);
    expect(stub.spies.update).not.toHaveBeenCalled();
  });

  it('conductor retirado → 410', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[filaConductor({ deletedAt: new Date('2026-05-01T00:00:00Z') })]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/conductores/${CONDUCTOR_ID}/telefono`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: TELEFONO_NUEVO }),
    });
    expect(res.status).toBe(410);
    expect(stub.spies.update).not.toHaveBeenCalled();
  });
});

const OTRA_EMPRESA_ID = '99999999-9999-9999-9999-999999999999';

function usuarioPendienteConPin(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    fullName: 'Camila Rojas',
    firebaseUid: 'pending-rut:11.111.111-1',
    claveNumericaHash: null,
    activationPinHash: 'hash-previo',
    email: EMAIL_REAL,
    phone: '+56911111111',
    ...overrides,
  };
}

function conductorRetirado(empresaId: string) {
  return {
    id: CONDUCTOR_ID,
    deletedAt: new Date('2026-05-01T00:00:00Z'),
    empresaId,
  };
}

function membresiaConductor(empresaId: string) {
  return {
    empresaId,
    role: 'conductor',
    organizacionId: null,
    status: 'activa',
  };
}

function conductorReactivado() {
  return {
    ...conductorInsertado(),
    licenseExpiry: '2028-06-28',
    deletedAt: null,
  };
}

describe('POST /conductores — reactivación de un conductor retirado', () => {
  it('misma empresa: reactiva, pisa el teléfono, regenera el PIN y avisa por WhatsApp', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [usuarioPendienteConPin()],
        [conductorRetirado(EMPRESA_ID)],
        [membresiaConductor(EMPRESA_ID)],
        [],
      ],
      updateReturning: [[conductorReactivado()]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM-react' }));
    const send = vi.fn(async () => ({ enviado: true as const, id: 'mail-1' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
      emailSender: { send },
    });
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      reactivado?: boolean;
      activation_pin?: string;
      conductor: { status: string; deleted_at: string | null; license_number: string };
    };
    expect(body.reactivado).toBe(true);
    expect(body.activation_pin).toMatch(/^\d{6}$/);
    expect(body.conductor.status).toBe('activo');
    expect(body.conductor.deleted_at).toBeNull();
    expect(body.conductor.license_number).toBe('LIC-1');
    expect(stub.spies.insert).not.toHaveBeenCalled();

    const payloads = payloadsDeUpdate(stub.spies.update);
    const usuario = payloads.find((payload) => 'activationPinHash' in payload);
    const fila = payloads.find((payload) => 'driverStatus' in payload);
    expect(usuario?.phone).toBe('+56957790379');
    expect(usuario?.activationPinHash).not.toBe('hash-previo');
    expect(verifyActivationPin(body.activation_pin ?? '', String(usuario?.activationPinHash))).toBe(
      true,
    );
    expect(fila).toMatchObject({
      licenseClass: 'A5',
      licenseNumber: 'LIC-1',
      licenseExpiry: '2028-06-28',
      isExtranjero: false,
      driverStatus: 'activo',
      deletedAt: null,
    });
    expect(sendContent).toHaveBeenCalledTimes(1);
    expect(sendContent.mock.calls[0]?.[0]).toMatchObject({ to: '+56957790379' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: EMAIL_REAL });
    expect(String(send.mock.calls[0]?.[0]?.text)).toContain(body.activation_pin);
  });

  it('email de relleno: lo reemplaza en la reactivación y no inserta otro conductor', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          usuarioPendienteConPin({
            email: 'pending-rut-111111111@boosterchile.invalid',
          }),
        ],
        [conductorRetirado(EMPRESA_ID)],
        [membresiaConductor(EMPRESA_ID)],
        [],
      ],
      updateReturning: [[conductorReactivado()]],
      insertReturning: [[{ id: 'audit-1' }]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM-react' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reactivado?: boolean; activation_pin?: string };
    expect(body.reactivado).toBe(true);
    expect(body.activation_pin).toMatch(/^\d{6}$/);
    expect(
      payloadsDeUpdate(stub.spies.update).some(
        (payload) => payload.email === EMAIL_REAL && payload.phone === '+56957790379',
      ),
    ).toBe(true);
    expect(stub.spies.insert).toHaveBeenCalledTimes(1);
    expect(sendContent).toHaveBeenCalledTimes(1);
  });

  it('cuenta ya activa: reactiva y pisa el teléfono, sin PIN ni WhatsApp', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [
          usuarioPendienteConPin({
            firebaseUid: 'fb-real-uid',
            claveNumericaHash: 'hash-clave',
          }),
        ],
        [conductorRetirado(EMPRESA_ID)],
        [membresiaConductor(EMPRESA_ID)],
        [],
      ],
      updateReturning: [[conductorReactivado()]],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM-react' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { reactivado?: boolean; activation_pin?: string };
    expect(body.reactivado).toBe(true);
    expect(body.activation_pin).toBeUndefined();
    expect(
      payloadsDeUpdate(stub.spies.update).some((payload) => 'activationPinHash' in payload),
    ).toBe(false);
    expect(
      payloadsDeUpdate(stub.spies.update).some((payload) => payload.phone === '+56957790379'),
    ).toBe(true);
    expect(stub.spies.insert).not.toHaveBeenCalled();
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('identidad compartida → 409 identidad_vinculada y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [usuarioPendienteConPin()],
        [conductorRetirado(EMPRESA_ID)],
        [membresiaConductor(OTRA_EMPRESA_ID)],
      ],
    });
    const sendContent = vi.fn(async () => ({ sid: 'SM-react' }));
    const app = await buildApp(stub.db, {
      whatsappClient: { sendContent },
      activacionContentSid: 'HXtest',
    });
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('identidad_vinculada');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('retirado de otra empresa → 409 conductor_retirado_otra_empresa y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [[usuarioPendienteConPin()], [conductorRetirado(OTRA_EMPRESA_ID)]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string; message?: string };
    expect(body.code).toBe('conductor_retirado_otra_empresa');
    expect(body.message).toBe(
      'Este conductor fue retirado de otra empresa. No lo puedes reactivar desde aquí.',
    );
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
  });

  it('conductor activo → 409 user_already_driver y no escribe', async () => {
    const stub = makeDbStub({
      selectQueueRows: [
        [usuarioPendienteConPin()],
        [{ id: CONDUCTOR_ID, deletedAt: null, empresaId: EMPRESA_ID }],
      ],
    });
    const app = await buildApp(stub.db);
    const res = await app.request('/conductores', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA_BODY),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('user_already_driver');
    expect(stub.spies.update).not.toHaveBeenCalled();
    expect(stub.spies.insert).not.toHaveBeenCalled();
  });
});
