import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADMIN_EMAIL = 'dev@boosterchile.com';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const EMPRESA_ID = '33333333-3333-4333-8333-333333333333';
const IMEI = '356307042441013';

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

const BODY = { vehiculo_id: VEHICLE_ID, teltonika_imei: IMEI };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/plataforma/dispositivos/asignar', () => {
  it('escribe el IMEI en el camión aunque el Teltonika no haya llamado al gateway', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [
        {
          id: VEHICLE_ID,
          plate: 'ABCD12',
          empresaId: EMPRESA_ID,
          teltonikaImei: null,
          teltonikaImeiEspejo: null,
        },
      ],
      [],
      [],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/asignar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { patente: string; reconciliacion: string };
    expect(json.patente).toBe('ABCD12');
    expect(json.reconciliacion).toBe('sin_registro');
    expect(d.updates[0]).toMatchObject({ teltonikaImei: IMEI });
  });

  it('rechaza un IMEI que ya está en otro camión', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [
        {
          id: VEHICLE_ID,
          plate: 'ABCD12',
          empresaId: EMPRESA_ID,
          teltonikaImei: null,
          teltonikaImeiEspejo: null,
        },
      ],
      [{ id: 'otro-camion' }],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/asignar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_en_uso');
    expect(d.updates).toHaveLength(0);
  });

  it('no escribe un IMEI propio si el camión mira el GPS de otro equipo', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [
        {
          id: VEHICLE_ID,
          plate: 'ABCD12',
          empresaId: EMPRESA_ID,
          teltonikaImei: null,
          teltonikaImeiEspejo: '356307042441013',
        },
      ],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/asignar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_espejo_activo');
    expect(d.updates).toHaveLength(0);
  });

  it('rechaza un IMEI que no tiene 15 dígitos', async () => {
    const mod = await loadMod();
    const d = makeDb([]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/asignar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BODY, teltonika_imei: '123' }),
    });

    expect(res.status).toBe(400);
  });

  it('no asigna quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb([]);
    const app = buildApp(mod, d.db, 'ajeno@otra.cl');

    const res = await app.request('/asignar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(403);
  });
});
