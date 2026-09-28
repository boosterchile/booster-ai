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

function makeDb(
  selects: unknown[][],
  opts?: { insertRow?: Record<string, unknown>; insertError?: unknown },
) {
  const queue = [...selects];
  const updates: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];
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
  const insert = vi.fn(() => ({
    values: vi.fn((vals: Record<string, unknown>) => {
      inserted.push(vals);
      return {
        returning: vi.fn(async () => {
          if (opts?.insertError) {
            throw opts.insertError;
          }
          return opts?.insertRow ? [opts.insertRow] : [];
        }),
      };
    }),
  }));
  const db = { select, update, insert };
  return {
    db: {
      ...db,
      transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    } as never,
    updates,
    inserted,
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

const ALTA = {
  empresa_id: EMPRESA_ID,
  teltonika_imei: IMEI,
  plate: 'ABCD12',
  vehicle_type: 'camion_pequeno',
  capacity_kg: 3500,
  brand: 'Volvo',
  model: 'FH',
};

describe('POST /admin/plataforma/dispositivos/habilitar', () => {
  it('crea el vehículo en la empresa y le escribe el IMEI aunque el equipo no haya llamado al gateway', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }], [], []],
      {
        insertRow: {
          id: VEHICLE_ID,
          plate: 'ABCD12',
          empresaId: EMPRESA_ID,
          teltonikaImei: IMEI,
        },
      },
    );
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      patente: string;
      empresa_id: string;
      teltonika_imei: string;
      reconciliacion: string;
    };
    expect(json.patente).toBe('ABCD12');
    expect(json.empresa_id).toBe(EMPRESA_ID);
    expect(json.teltonika_imei).toBe(IMEI);
    expect(json.reconciliacion).toBe('sin_registro');
    expect(d.inserted[0]).toMatchObject({
      empresaId: EMPRESA_ID,
      plate: 'ABCD12',
      teltonikaImei: IMEI,
      vehicleType: 'camion_pequeno',
      capacityKg: 3500,
      brand: 'Volvo',
      model: 'FH',
      unitType: 'camion_rigido',
    });
  });

  it('no crea el vehículo si la empresa no es transportista', async () => {
    const mod = await loadMod();
    const d = makeDb([[{ id: EMPRESA_ID, isTransportista: false, legalName: 'Generador' }]]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('empresa_no_transportista');
    expect(d.inserted).toHaveLength(0);
  });

  it('rechaza un IMEI que ya está en otro camión', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }],
      [{ id: 'otro-camion' }],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_en_uso');
    expect(d.inserted).toHaveLength(0);
  });

  it('rechaza una patente que ya existe', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }], [], []],
      { insertError: { code: '23505', constraint: 'vehiculos_patente_key' } },
    );
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('plate_duplicate');
  });

  it('no crea el vehículo si la empresa no existe', async () => {
    const mod = await loadMod();
    const d = makeDb([[]]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('empresa_no_encontrada');
    expect(d.inserted).toHaveLength(0);
  });

  it('no inserta un semi-remolque sin peso vacío', async () => {
    const mod = await loadMod();
    const d = makeDb([[{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }]]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ALTA, vehicle_type: 'semi_remolque' }),
    });

    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('arrastre_curb_weight_requerido');
    expect(d.inserted).toHaveLength(0);
  });

  it('no reasigna un IMEI que fue rechazado', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }],
      [],
      [{ id: 'pd-1', status: 'rechazado', assignedToVehicleId: null }],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_rechazado');
    expect(d.inserted).toHaveLength(0);
  });

  it('marca aprobado el pendiente del gateway y guarda los datos opcionales', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [
        [{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }],
        [],
        [{ id: 'pd-1', status: 'pendiente', assignedToVehicleId: null }],
      ],
      {
        insertRow: {
          id: VEHICLE_ID,
          plate: 'ABCD12',
          empresaId: EMPRESA_ID,
          teltonikaImei: IMEI,
        },
      },
    );
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...ALTA,
        capacity_m3: 20,
        year: 2022,
        fuel_type: 'diesel',
        curb_weight_kg: 8000,
      }),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { reconciliacion: string };
    expect(json.reconciliacion).toBe('aprobado');
    expect(d.inserted[0]).toMatchObject({
      capacityM3: 20,
      year: 2022,
      fuelType: 'diesel',
      curbWeightKg: 8000,
    });
    expect(d.updates[0]).toMatchObject({
      status: 'aprobado',
      assignedToVehicleId: VEHICLE_ID,
      assignedByUserId: 'admin-id',
    });
  });

  it('no crea el vehículo si el IMEI pendiente ya está aprobado en otro camión', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }],
      [],
      [{ id: 'pd-1', status: 'aprobado', assignedToVehicleId: 'otro-camion' }],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_en_uso');
    expect(d.inserted).toHaveLength(0);
  });

  it('responde 500 si el insert no devuelve la fila', async () => {
    const mod = await loadMod();
    const d = makeDb([
      [{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }],
      [],
      [],
    ]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('insert_failed');
  });

  it('trata como IMEI en uso un unique que no es de patente, aunque venga anidado', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }], [], []],
      { insertError: { cause: { code: '23505', constraint: 'vehiculos_teltonika_imei_key' } } },
    );
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('imei_en_uso');
  });

  it('deja pasar un error de base que no es unique', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[{ id: EMPRESA_ID, isTransportista: true, legalName: 'Transportes Sur' }], [], []],
      { insertError: { nope: true } },
    );
    const app = buildApp(mod, d.db);

    await expect(
      app.request('/habilitar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ALTA),
      }),
    ).rejects.toEqual({ nope: true });
  });

  it('rechaza una patente inválida antes de tocar la base', async () => {
    const mod = await loadMod();
    const d = makeDb([]);
    const app = buildApp(mod, d.db);

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...ALTA, plate: '123' }),
    });

    expect(res.status).toBe(400);
    expect(d.inserted).toHaveLength(0);
  });

  it('no habilita quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb([]);
    const app = buildApp(mod, d.db, 'ajeno@otra.cl');

    const res = await app.request('/habilitar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ALTA),
    });

    expect(res.status).toBe(403);
    expect(d.inserted).toHaveLength(0);
  });
});
