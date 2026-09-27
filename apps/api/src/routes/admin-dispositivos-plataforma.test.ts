import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_EMAIL = 'dev@boosterchile.com';
const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const EMPRESA_ID = '33333333-3333-4333-8333-333333333333';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never as Logger;

function makeDb(selects: unknown[][]) {
  const queue = [...selects];
  const updates: Record<string, unknown>[] = [];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => queue.shift() ?? []);
    return chain;
  });
  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      updates.push(vals);
      return { where: vi.fn(async () => undefined) };
    }),
  }));
  const db = { select, update };
  return {
    db: {
      ...db,
      transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    } as never,
    updates,
  };
}

function buildApp(
  mod: typeof import('./admin-dispositivos-plataforma.js'),
  db: ReturnType<typeof makeDb>['db'],
  email = ADMIN_EMAIL,
) {
  const routes = mod.createAdminDispositivosPlataformaRoutes({ db, logger: noopLogger });
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
      user: { id: 'admin-id', email },
    });
    await next();
  });
  app.route('/', routes);
  return app;
}

async function loadMod() {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] },
  }));
  return import('./admin-dispositivos-plataforma.js');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/plataforma/dispositivos/:id/asociar', () => {
  it('habilita el camión de un transportista sin ser miembro de esa empresa', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: DEVICE_ID, imei: '356307042441013', status: 'pendiente' }],
      [{ id: VEHICLE_ID, plate: 'ABCD12', empresaId: EMPRESA_ID, teltonikaImei: null }],
      [],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request(`/${DEVICE_ID}/asociar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehiculo_id: VEHICLE_ID }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { patente: string; imei: string; empresa_id: string };
    expect(json.patente).toBe('ABCD12');
    expect(json.imei).toBe('356307042441013');
    expect(json.empresa_id).toBe(EMPRESA_ID);
    expect(d.updates[0]).toMatchObject({ teltonikaImei: '356307042441013' });
    expect(d.updates[1]).toMatchObject({ status: 'aprobado', assignedToVehicleId: VEHICLE_ID });
  });

  it('rechaza un camión que ya tiene otro dispositivo', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: DEVICE_ID, imei: '356307042441013', status: 'pendiente' }],
      [{ id: VEHICLE_ID, plate: 'ABCD12', empresaId: EMPRESA_ID, teltonikaImei: '999' }],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request(`/${DEVICE_ID}/asociar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehiculo_id: VEHICLE_ID }),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('vehicle_has_other_device');
    expect(d.updates).toHaveLength(0);
  });

  it('no asocia quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb([]);
    const app = buildApp(mod, d.db, 'ajeno@otra.cl');

    const res = await app.request(`/${DEVICE_ID}/asociar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vehiculo_id: VEHICLE_ID }),
    });

    expect(res.status).toBe(403);
  });
});
