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
  typeof import('../../src/routes/sucursales.js').createSucursalesRoutes
>[0]['logger'];

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const SUCURSAL_ID = '22222222-2222-2222-2222-222222222222';

function buildSucursalRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SUCURSAL_ID,
    empresaId: EMPRESA_ID,
    nombre: 'Bodega Maipú',
    addressStreet: 'Av. Pajaritos 1234',
    addressCity: 'Maipú',
    addressRegion: 'XIII',
    latitude: '-33.5111',
    longitude: '-70.7575',
    operatingHours: 'L-V 8-18',
    isActive: true,
    createdAt: new Date('2026-05-10T22:00:00Z'),
    updatedAt: new Date('2026-05-10T22:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeDbStub(opts: {
  selectQueue?: Record<string, unknown>[][];
  insertRows?: Record<string, unknown>[];
  updateRows?: Record<string, unknown>[];
}) {
  const queue = [...(opts.selectQueue ?? [])];

  const orderBy = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn(() => ({ orderBy, limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const insertReturning = vi.fn(() => Promise.resolve(opts.insertRows ?? []));
  const values = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values }));

  const updateReturning = vi.fn(() => Promise.resolve(opts.updateRows ?? []));
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, insert, update } as unknown as Parameters<
      typeof import('../../src/routes/sucursales.js').createSucursalesRoutes
    >[0]['db'],
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/sucursales.js').createSucursalesRoutes>[0]['db'],
  opts: { role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | null } = { role: 'dueno' },
) {
  const { createSucursalesRoutes } = await import('../../src/routes/sucursales.js');
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
  app.route('/sucursales', createSucursalesRoutes({ db, logger: noopLogger }));
  return app;
}

describe('sucursales routes', () => {
  it('GET / sin auth → 401', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: null });
    const res = await app.request('/sucursales');
    expect(res.status).toBe(401);
  });

  it('GET / lista de la empresa activa', async () => {
    const stub = makeDbStub({ selectQueue: [[buildSucursalRow()]] });
    const app = await buildApp(stub.db);
    const res = await app.request('/sucursales');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sucursales: Array<{ nombre: string; latitude: number | null }>;
    };
    expect(body.sucursales).toHaveLength(1);
    expect(body.sucursales[0]?.nombre).toBe('Bodega Maipú');
    expect(body.sucursales[0]?.latitude).toBeCloseTo(-33.5111, 4);
  });

  it('POST / rol conductor → 403', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: 'conductor' });
    const res = await app.request('/sucursales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nombre: 'X',
        address_street: 'Y 123',
        address_city: 'Stgo',
        address_region: 'XIII',
      }),
    });
    expect(res.status).toBe(403);
  });

  it('POST / despachador crea sucursal sin coords (lat/lng null)', async () => {
    const stub = makeDbStub({
      insertRows: [buildSucursalRow({ latitude: null, longitude: null })],
    });
    const app = await buildApp(stub.db, { role: 'despachador' });
    const res = await app.request('/sucursales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nombre: 'Bodega Maipú',
        address_street: 'Av. Pajaritos 1234',
        address_city: 'Maipú',
        address_region: 'XIII',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      sucursal: { nombre: string; latitude: number | null; longitude: number | null };
    };
    expect(body.sucursal.nombre).toBe('Bodega Maipú');
    expect(body.sucursal.latitude).toBeNull();
    expect(body.sucursal.longitude).toBeNull();
  });

  it('POST / valida region inválida → 400', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db);
    const res = await app.request('/sucursales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nombre: 'X',
        address_street: 'Y',
        address_city: 'Stgo',
        address_region: 'XX', // inválida
      }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id actualiza coords parciales', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: SUCURSAL_ID, deletedAt: null }]],
      updateRows: [buildSucursalRow({ latitude: '-33.5', longitude: '-70.7' })],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/sucursales/${SUCURSAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ latitude: -33.5, longitude: -70.7 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sucursal: { latitude: number; longitude: number } };
    expect(body.sucursal.latitude).toBeCloseTo(-33.5, 4);
  });

  it('PATCH /:id sobre sucursal eliminada → 410', async () => {
    const stub = makeDbStub({
      selectQueue: [[{ id: SUCURSAL_ID, deletedAt: new Date('2026-05-09T00:00:00Z') }]],
    });
    const app = await buildApp(stub.db);
    const res = await app.request(`/sucursales/${SUCURSAL_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'X' }),
    });
    expect(res.status).toBe(410);
  });

  it('DELETE /:id como despachador → 403 (admin only)', async () => {
    const stub = makeDbStub({});
    const app = await buildApp(stub.db, { role: 'despachador' });
    const res = await app.request(`/sucursales/${SUCURSAL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  it('DELETE /:id como dueno → soft delete', async () => {
    const stub = makeDbStub({
      updateRows: [buildSucursalRow({ deletedAt: new Date(), isActive: false })],
    });
    const app = await buildApp(stub.db, { role: 'dueno' });
    const res = await app.request(`/sucursales/${SUCURSAL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; sucursal_id: string };
    expect(body.ok).toBe(true);
    expect(body.sucursal_id).toBe(SUCURSAL_ID);
  });

  it('DELETE /:id no encontrado → 404', async () => {
    const stub = makeDbStub({ updateRows: [] });
    const app = await buildApp(stub.db);
    const res = await app.request(`/sucursales/${SUCURSAL_ID}`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
