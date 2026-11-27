import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const registrarCargaCombustible = vi.fn();
const listarCargasCombustible = vi.fn();
const anularCargaCombustible = vi.fn();
vi.mock('../../src/services/cargas-combustible.js', () => ({
  registrarCargaCombustible,
  listarCargasCombustible,
  anularCargaCombustible,
}));

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

type RoutesOpts = Parameters<
  typeof import('../../src/routes/vehiculos.js').createVehiculosRoutes
>[0];

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as RoutesOpts['logger'];

const EMPRESA_ID = '11111111-1111-4111-8111-111111111111';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const CARGA_ID = '44444444-4444-4444-8444-444444444444';
const BASE = `/vehiculos/${VEHICLE_ID}/cargas-combustible`;

const fila = {
  id: CARGA_ID,
  empresaId: EMPRESA_ID,
  vehiculoId: VEHICLE_ID,
  cargadaEn: new Date('2026-10-28T12:30:00Z'),
  litros: 100,
  lugar: 'Copec Ruta 5 km 210',
  registradaPor: 'u-1',
  registradaEn: new Date('2026-11-27T15:00:00Z'),
  anuladaEn: null,
  anuladaPor: null,
};
const json = {
  id: CARGA_ID,
  vehiculo_id: VEHICLE_ID,
  cargada_en: '2026-10-28T12:30:00.000Z',
  litros: 100,
  lugar: 'Copec Ruta 5 km 210',
  registrada_en: '2026-11-27T15:00:00.000Z',
  anulada_en: null,
};

/** Solo la consulta de pertenencia del vehículo: el resto lo hace el servicio. */
function dbConVehiculo(existe: boolean) {
  const limit = vi.fn().mockResolvedValue(existe ? [{ id: VEHICLE_ID }] : []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select } as unknown as RoutesOpts['db'], select };
}

async function buildApp(
  db: RoutesOpts['db'],
  role: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador' | null = 'dueno',
) {
  const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (role !== null) {
      c.set('userContext', {
        user: { id: 'u-1', firebaseUid: 'fb-1', email: 'test@x.com' },
        memberships: [],
        activeMembership: {
          membership: { id: 'm-1', role },
          empresa: { id: EMPRESA_ID, legal_name: 'Test SA', isTransportista: true },
        },
      });
    }
    await next();
  });
  app.route('/vehiculos', createVehiculosRoutes({ db, logger: noopLogger }));
  return app;
}

const post = (app: Hono, body: unknown) =>
  app.request(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const valido = {
  cargada_en: '2026-10-28T09:30:45-03:00',
  litros: 100,
  lugar: 'Copec Ruta 5 km 210',
};

beforeEach(() => {
  registrarCargaCombustible.mockReset();
  listarCargasCombustible.mockReset();
  anularCargaCombustible.mockReset();
});

describe('POST /vehiculos/:id/cargas-combustible', () => {
  it('registra la carga con la fecha truncada al minuto → 201', async () => {
    registrarCargaCombustible.mockResolvedValue({ ok: true, carga: fila });
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db), valido);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ carga: json });
    expect(registrarCargaCombustible).toHaveBeenCalledWith({
      db,
      empresaId: EMPRESA_ID,
      vehiculoId: VEHICLE_ID,
      cargadaEn: new Date('2026-10-28T12:30:00.000Z'),
      litros: 100,
      lugar: 'Copec Ruta 5 km 210',
      registradaPor: 'u-1',
    });
  });

  it('sin lugar guarda null y redondea los litros a un decimal', async () => {
    registrarCargaCombustible.mockResolvedValue({ ok: true, carga: { ...fila, lugar: null } });
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db, 'despachador'), {
      cargada_en: valido.cargada_en,
      litros: 99.96,
      lugar: '   ',
    });
    expect(res.status).toBe(201);
    expect(registrarCargaCombustible).toHaveBeenCalledWith(
      expect.objectContaining({ litros: 100, lugar: null }),
    );
  });

  it('la misma carga dos veces → 409 carga_duplicada', async () => {
    registrarCargaCombustible.mockResolvedValue({ ok: false, code: 'carga_duplicada' });
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db), valido);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('carga_duplicada');
  });

  it.each([
    ['litros en cero', { ...valido, litros: 0 }],
    ['litros sobre 2000', { ...valido, litros: 2001 }],
    [
      'fecha en el futuro',
      { ...valido, cargada_en: new Date(Date.now() + 3_600_000).toISOString() },
    ],
    ['fecha anterior a 2024', { ...valido, cargada_en: '2023-12-31T23:59:00Z' }],
    ['fecha sin zona', { ...valido, cargada_en: '2026-10-28T09:30' }],
    ['lugar demasiado largo', { ...valido, lugar: 'x'.repeat(201) }],
  ])('%s → 400 sin registrar', async (_caso, body) => {
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db), body);
    expect(res.status).toBe(400);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it.each(['conductor', 'visualizador'] as const)('%s → 403 sin registrar', async (role) => {
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db, role), valido);
    expect(res.status).toBe(403);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it('un vehículo de otra empresa → 404 sin registrar', async () => {
    const { db } = dbConVehiculo(false);
    const res = await post(await buildApp(db), valido);
    expect(res.status).toBe(404);
    expect(registrarCargaCombustible).not.toHaveBeenCalled();
  });

  it('un id que no es uuid → 404 sin consultar', async () => {
    const { db, select } = dbConVehiculo(true);
    const app = await buildApp(db);
    const res = await app.request('/vehiculos/no-es-uuid/cargas-combustible', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(valido),
    });
    expect(res.status).toBe(404);
    expect(select).not.toHaveBeenCalled();
  });

  it('sin sesión → 401', async () => {
    const { db } = dbConVehiculo(true);
    const res = await post(await buildApp(db, null), valido);
    expect(res.status).toBe(401);
  });
});

describe('GET /vehiculos/:id/cargas-combustible', () => {
  it('lista las cargas vigentes del vehículo', async () => {
    listarCargasCombustible.mockResolvedValue([fila]);
    const { db } = dbConVehiculo(true);
    const app = await buildApp(db, 'admin');
    const res = await app.request(BASE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cargas: [json] });
    expect(listarCargasCombustible).toHaveBeenCalledWith({
      db,
      empresaId: EMPRESA_ID,
      vehiculoId: VEHICLE_ID,
      limite: 100,
    });
  });

  it('el conductor no ve las cargas → 403', async () => {
    const { db } = dbConVehiculo(true);
    const res = await (await buildApp(db, 'conductor')).request(BASE);
    expect(res.status).toBe(403);
    expect(listarCargasCombustible).not.toHaveBeenCalled();
  });

  it('un vehículo de otra empresa → 404', async () => {
    const { db } = dbConVehiculo(false);
    const res = await (await buildApp(db)).request(BASE);
    expect(res.status).toBe(404);
    expect(listarCargasCombustible).not.toHaveBeenCalled();
  });
});

describe('DELETE /vehiculos/:id/cargas-combustible/:cargaId', () => {
  const anular = (app: Hono, cargaId = CARGA_ID) =>
    app.request(`${BASE}/${cargaId}`, { method: 'DELETE' });

  it('anula la carga y la devuelve → 200', async () => {
    const anulada = { ...fila, anuladaEn: new Date('2026-11-27T16:00:00Z'), anuladaPor: 'u-1' };
    anularCargaCombustible.mockResolvedValue(anulada);
    const { db } = dbConVehiculo(true);
    const res = await anular(await buildApp(db));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      carga: { ...json, anulada_en: '2026-11-27T16:00:00.000Z' },
    });
    expect(anularCargaCombustible).toHaveBeenCalledWith({
      db,
      empresaId: EMPRESA_ID,
      vehiculoId: VEHICLE_ID,
      cargaId: CARGA_ID,
      anuladaPor: 'u-1',
    });
  });

  it('una carga que no es de ese vehículo o empresa → 404', async () => {
    anularCargaCombustible.mockResolvedValue(null);
    const { db } = dbConVehiculo(true);
    const res = await anular(await buildApp(db));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('carga_not_found');
  });

  it('un id de carga que no es uuid → 404 sin anular', async () => {
    const { db } = dbConVehiculo(true);
    const res = await anular(await buildApp(db), 'x');
    expect(res.status).toBe(404);
    expect(anularCargaCombustible).not.toHaveBeenCalled();
  });

  it('el visualizador no anula → 403', async () => {
    const { db } = dbConVehiculo(true);
    const res = await anular(await buildApp(db, 'visualizador'));
    expect(res.status).toBe(403);
    expect(anularCargaCombustible).not.toHaveBeenCalled();
  });
});
