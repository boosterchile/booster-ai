import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const { config: appConfig } = await import('../../src/config.js');
const { createAdminObservatorioRoutes } = await import('../../src/routes/admin-observatorio.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => logger,
} as never;

const ADMIN = 'admin@boosterchile.com';
const DATOS = {
  region: 'IV',
  k_min_vehiculos: 10,
  franjas: [{ mes: '2026-10', franja: '09-12', vehiculos: 12, viajes: 40 }],
  emisiones: [],
  od: [],
  activos: [{ mes: '2026-10', vehiculos: 15 }],
};

function buildApp(
  email: string | null,
  lector = { porRegion: vi.fn(async () => DATOS) } as {
    porRegion: ReturnType<typeof vi.fn>;
  } | null,
) {
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (email) {
      c.set('userContext', { user: { id: 'u1', email } } as never);
    }
    await next();
  });
  app.route('/admin/observatorio', createAdminObservatorioRoutes({ logger, lector }));
  return { app, lector };
}

afterEach(() => {
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [];
});

describe('GET /admin/observatorio/:region (T10-24)', () => {
  it('admin → 200 con las secciones del lector', async () => {
    const { app, lector } = buildApp(ADMIN);
    const res = await app.request('/admin/observatorio/IV');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DATOS);
    expect(lector?.porRegion).toHaveBeenCalledWith('IV');
  });

  it('sin sesión → 401; fuera de la allowlist → 403', async () => {
    expect((await buildApp(null).app.request('/admin/observatorio/IV')).status).toBe(401);
    expect((await buildApp('otro@x.cl').app.request('/admin/observatorio/IV')).status).toBe(403);
  });

  it('región que no es un código romano → 400 sin consultar', async () => {
    const { app, lector } = buildApp(ADMIN);
    for (const r of ['iv', 'CL-CO', 'IV1', 'ABCDE']) {
      expect((await app.request(`/admin/observatorio/${r}`)).status).toBe(400);
    }
    expect(lector?.porRegion).not.toHaveBeenCalled();
  });

  it('sin dataset configurado → 503 observatorio_no_configurado', async () => {
    const res = await buildApp(ADMIN, null).app.request('/admin/observatorio/IV');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'observatorio_no_configurado' });
  });

  it('nunca reenvía un bucket bajo k ni un vehiculo_id aunque el lector lo devuelva', async () => {
    const lector = {
      porRegion: vi.fn(async () => ({
        ...DATOS,
        od: [
          { mes: '2026-10', vehiculos: 3, viajes: 5 },
          { mes: '2026-10', vehiculos: 11, viajes: 20, vehiculo_id: 'v1' },
        ],
      })),
    };
    const res = await buildApp(ADMIN, lector).app.request('/admin/observatorio/IV');
    const body = (await res.json()) as { od: unknown[] };
    expect(body.od).toEqual([{ mes: '2026-10', vehiculos: 11, viajes: 20 }]);
  });
});
