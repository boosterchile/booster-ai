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
  insertError?: { code: string };
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
    const where = vi.fn(() => ({ orderBy, limit }));
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
    const returning = vi.fn(() => Promise.resolve(nextUpdate()));
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
  opts: { role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null } = {
    role: 'dueno',
  },
) {
  const { createConductoresRoutes } = await import('../../src/routes/conductores.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.role === null) {
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
  app.route('/conductores', createConductoresRoutes({ db, logger: noopLogger }));
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
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('rut_invalido');
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
          license_class: 'A5',
          license_number: 'LIC-12345',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { conductor: { id: string; license_expiry: string } };
      expect(body.conductor.id).toBe(CONDUCTOR_ID);
      expect(body.conductor.license_expiry).toBe('2027-12-31');
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
          license_class: 'A5',
          license_number: 'LIC-1',
          license_expiry: '2027-12-31',
        }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('user_already_driver');
    });

    it('user no existente → crea user pending + conductor 201', async () => {
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
