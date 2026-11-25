import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `.specs/una-sola-verdad-por-dato`: indicadores del negocio, solo para quien
 * tiene acceso al panel de plataforma.
 */
const ADMIN_EMAIL = 'dev@boosterchile.com';
const EMPRESA = '22222222-2222-4222-8222-222222222222';

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

const INDICADORES = {
  empresas_activas: 3,
  cargas: 12,
  camiones: 5,
  camiones_con_huella_medida: 1,
  certificados: { certificados: 4, medidos: 1, estimados: 3, kgco2e: 1254.5, ahorro_kgco2e: 0 },
  documentos_pendientes: 6,
};
const leer = vi.fn(async () => INDICADORES);
vi.mock('../services/indicadores-negocio.js', () => ({ indicadoresNegocio: leer }));
const counterAdd = vi.fn();
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: counterAdd }),
}));

function makeDb(empresas: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const paso of ['from', 'where']) {
    chain[paso] = vi.fn(() => chain);
  }
  chain.orderBy = vi.fn(async () => empresas);
  return { select: vi.fn(() => chain) } as never;
}

async function app(db: unknown, usuario: { email: string } | null = { email: ADMIN_EMAIL }) {
  vi.resetModules();
  vi.doMock('../config.js', () => ({ config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] } }));
  const mod = await import('./admin-indicadores.js');
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (usuario) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: usuario.email },
      });
    }
    await next();
  });
  a.route('/', mod.createAdminIndicadoresRoutes({ db: db as never, logger }));
  return a;
}

const EMPRESAS = [{ id: EMPRESA, nombre: 'Transportes Uno SpA' }];

describe('GET /admin/plataforma/indicadores', () => {
  beforeEach(() => {
    leer.mockClear();
    counterAdd.mockClear();
  });

  it('sin sesión → 401', async () => {
    const res = await (await app(makeDb(EMPRESAS), null)).request('/');
    expect(res.status).toBe(401);
    expect(leer).not.toHaveBeenCalled();
  });

  it('quien no es del panel → 403', async () => {
    const res = await (await app(makeDb(EMPRESAS), { email: 'otra@empresa.cl' })).request('/');
    expect(res.status).toBe(403);
    expect(leer).not.toHaveBeenCalled();
  });

  it('sin empresa: indicadores de la plataforma y la lista de empresas', async () => {
    const res = await (await app(makeDb(EMPRESAS))).request('/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      empresa_id: null,
      empresas: EMPRESAS,
      indicadores: INDICADORES,
    });
    expect(leer).toHaveBeenCalledWith(expect.objectContaining({ empresaId: undefined }));
    expect(counterAdd).toHaveBeenCalledWith(1, { alcance: 'plataforma' });
  });

  it('con empresa: indicadores de esa empresa', async () => {
    const res = await (await app(makeDb(EMPRESAS))).request(`/?empresa_id=${EMPRESA}`);
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { empresa_id: string };
    expect(cuerpo.empresa_id).toBe(EMPRESA);
    expect(leer).toHaveBeenCalledWith(expect.objectContaining({ empresaId: EMPRESA }));
    expect(counterAdd).toHaveBeenCalledWith(1, { alcance: 'empresa' });
  });

  it('empresa que no está activa o no existe → 404', async () => {
    const res = await (await app(makeDb([]))).request(`/?empresa_id=${EMPRESA}`);
    expect(res.status).toBe(404);
    expect(leer).not.toHaveBeenCalled();
  });

  it('empresa_id que no es un UUID → 400', async () => {
    const res = await (await app(makeDb(EMPRESAS))).request('/?empresa_id=abc');
    expect(res.status).toBe(400);
  });
});
