import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `.specs/frente2-cierre` §3.4 — el panel de plataforma lista las solicitudes
 * «Pedir a Booster» abiertas y las marca resueltas. Solo el personal de Booster.
 */
const ADMIN_EMAIL = 'dev@boosterchile.com';
const SOLICITUD = '33333333-3333-4333-8333-333333333333';
const VEHICULO = '22222222-2222-4222-8222-222222222222';
const EMPRESA = '11111111-1111-4111-8111-111111111111';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never as Logger;

const listar = vi.fn();
const resolver = vi.fn();
vi.mock('../services/solicitudes-booster.js', () => ({
  listarSolicitudesAbiertas: listar,
  resolverSolicitud: resolver,
}));
const counterAdd = vi.fn();
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: counterAdd }),
}));

const db = {} as never;

async function app(usuario: { email: string } | null = { email: ADMIN_EMAIL }) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({ config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] } }));
  const mod = await import('./admin-solicitudes-booster.js');
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (usuario) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: usuario.email },
      });
    }
    await next();
  });
  a.route('/', mod.createAdminSolicitudesBoosterRoutes({ db, logger }));
  return a;
}

const creadaEn = new Date('2026-11-26T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('acceso: solo el panel de plataforma', () => {
  it.each([
    ['GET', '/'],
    ['POST', `/${SOLICITUD}/resolver`],
  ])('%s %s sin sesión responde 401 y no toca nada', async (metodo, ruta) => {
    const res = await (await app(null)).request(ruta, { method: metodo });
    expect(res.status).toBe(401);
    expect(listar).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', '/'],
    ['POST', `/${SOLICITUD}/resolver`],
  ])('%s %s con una cuenta sin acceso al panel responde 403', async (metodo, ruta) => {
    const res = await (await app({ email: 'dueno@transportes.cl' })).request(ruta, {
      method: metodo,
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_platform_admin' });
    expect(listar).not.toHaveBeenCalled();
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('GET / — las solicitudes abiertas de todas las empresas', () => {
  it('trae empresa, patente, tipo y cuándo se pidió', async () => {
    listar.mockResolvedValue([
      {
        id: SOLICITUD,
        tipo: 'configurar_fuente_combustible',
        empresaId: EMPRESA,
        empresaNombre: 'Transportes Andes Ltda.',
        vehiculoId: VEHICULO,
        patente: 'KZXB64',
        creadaEn,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        tipo: 'configurar_fuente_combustible',
        empresaId: EMPRESA,
        empresaNombre: 'Transportes Andes Ltda.',
        vehiculoId: null,
        patente: null,
        creadaEn,
      },
    ]);
    const res = await (await app()).request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      solicitudes: [
        {
          id: SOLICITUD,
          tipo: 'configurar_fuente_combustible',
          empresa: { id: EMPRESA, nombre: 'Transportes Andes Ltda.' },
          vehiculo: { id: VEHICULO, patente: 'KZXB64' },
          creada_en: '2026-11-26T12:00:00.000Z',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          tipo: 'configurar_fuente_combustible',
          empresa: { id: EMPRESA, nombre: 'Transportes Andes Ltda.' },
          vehiculo: null,
          creada_en: '2026-11-26T12:00:00.000Z',
        },
      ],
    });
    expect(counterAdd).toHaveBeenCalledWith(1, { vista: 'lista' });
  });
});

describe('POST /:id/resolver — con la fuente CAN configurada (.specs/frente2-cierre D3)', () => {
  it('pasa la fuente CAN al servicio para escribirla en el camión', async () => {
    resolver.mockResolvedValue({
      resultado: 'resuelta',
      solicitud: {
        id: SOLICITUD,
        tipo: 'configurar_fuente_combustible',
        estado: 'resuelta',
        vehiculoId: VEHICULO,
        creadaEn,
        resueltaEn: new Date('2026-11-26T13:00:00Z'),
        resueltaPor: 'admin-id',
      },
    });
    const res = await (await app()).request(`/${SOLICITUD}/resolver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fuente_combustible_can: '83' }),
    });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith({
      db,
      id: SOLICITUD,
      resueltaPor: 'admin-id',
      fuenteCombustibleCan: '83',
    });
  });

  it('una fuente CAN fuera del conjunto: 400 sin resolver', async () => {
    resolver.mockReset();
    const res = await (await app()).request(`/${SOLICITUD}/resolver`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fuente_combustible_can: '99' }),
    });
    expect(res.status).toBe(400);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('POST /:id/resolver — marcarla resuelta', () => {
  it('la marca resuelta con quién y cuándo', async () => {
    const resueltaEn = new Date('2026-11-26T13:00:00Z');
    resolver.mockResolvedValue({
      resultado: 'resuelta',
      solicitud: {
        id: SOLICITUD,
        tipo: 'configurar_fuente_combustible',
        estado: 'resuelta',
        vehiculoId: VEHICULO,
        creadaEn,
        resueltaEn,
        resueltaPor: 'admin-id',
      },
    });
    const res = await (await app()).request(`/${SOLICITUD}/resolver`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(resolver).toHaveBeenCalledWith({ db, id: SOLICITUD, resueltaPor: 'admin-id' });
    expect(await res.json()).toEqual({
      solicitud: {
        id: SOLICITUD,
        tipo: 'configurar_fuente_combustible',
        estado: 'resuelta',
        resuelta_en: '2026-11-26T13:00:00.000Z',
        resuelta_por: 'admin-id',
      },
    });
    expect(counterAdd).toHaveBeenCalledWith(1, { tipo: 'configurar_fuente_combustible' });
  });

  it('una ya resuelta responde 409', async () => {
    resolver.mockResolvedValue({ resultado: 'ya_resuelta' });
    const res = await (await app()).request(`/${SOLICITUD}/resolver`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'solicitud_ya_resuelta' });
    expect(counterAdd).not.toHaveBeenCalled();
  });

  it('una que no existe responde 404', async () => {
    resolver.mockResolvedValue({ resultado: 'no_existe' });
    const res = await (await app()).request(`/${SOLICITUD}/resolver`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'solicitud_not_found' });
  });

  it('un id que no es uuid responde 404 sin consultar', async () => {
    const res = await (await app()).request('/no-es-uuid/resolver', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(resolver).not.toHaveBeenCalled();
  });
});
