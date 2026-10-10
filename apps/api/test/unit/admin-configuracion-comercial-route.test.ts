import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/configuracion-comercial.js', () => ({
  leerConfiguracionPublicada: vi.fn(),
  listarHistorialConfiguracion: vi.fn(),
  publicarConfiguracionComercial: vi.fn(),
}));

vi.mock('../../src/services/contrato-programado.js', () => ({
  listarGeneradoresContratoProgramado: vi.fn(),
  cambiarContratoProgramado: vi.fn(),
}));

const svc = await import('../../src/services/configuracion-comercial.js');
const cp = await import('../../src/services/contrato-programado.js');
const { config: appConfig } = await import('../../src/config.js');
const { createAdminConfiguracionComercialRoutes } = await import(
  '../../src/routes/admin-configuracion-comercial.js'
);

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
const version = (n: number, spot = 20) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  version: n,
  config: {
    ...CONFIGURACION_COMERCIAL_INICIAL,
    comisiones: { ...CONFIGURACION_COMERCIAL_INICIAL.comisiones, spot_pct: spot },
  },
  vigenteDesde: new Date('2026-10-08T12:00:00Z'),
  notaCambio: `v${n}`,
  creadoPorEmail: ADMIN,
  creadoEn: new Date('2026-10-08T12:00:00Z'),
});

function buildApp(email: string | null) {
  const invalidar = vi.fn();
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (email !== null) {
      c.set('userContext' as never, { user: { email } } as never);
    }
    await next();
  });
  app.route(
    '/admin/configuracion-comercial',
    createAdminConfiguracionComercialRoutes({
      db: {} as never,
      logger,
      lector: { obtener: vi.fn(), invalidar },
    }),
  );
  const put = (body: unknown) =>
    app.request('/admin/configuracion-comercial', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { app, put, invalidar };
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
});

describe('admin configuración comercial (ADR-079 §3)', () => {
  it('sin sesión → 401; email fuera de la allowlist → 403', async () => {
    expect((await buildApp(null).app.request('/admin/configuracion-comercial')).status).toBe(401);
    expect((await buildApp('otro@x.cl').app.request('/admin/configuracion-comercial')).status).toBe(
      403,
    );
    expect((await buildApp('otro@x.cl').put({})).status).toBe(403);
  });

  it('GET devuelve la publicada y el historial', async () => {
    vi.mocked(svc.leerConfiguracionPublicada).mockResolvedValueOnce(version(2));
    vi.mocked(svc.listarHistorialConfiguracion).mockResolvedValueOnce([version(2), version(1)]);
    const res = await buildApp(ADMIN).app.request('/admin/configuracion-comercial');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { publicada: { version: number }; historial: unknown[] };
    expect(body.publicada.version).toBe(2);
    expect(body.historial).toHaveLength(2);
  });

  it('PUT válido publica, invalida la caché y responde la versión nueva', async () => {
    vi.mocked(svc.publicarConfiguracionComercial).mockResolvedValueOnce(version(3, 18));
    const { put, invalidar } = buildApp(ADMIN.toUpperCase());
    const config = version(3, 18).config;

    const res = await put({ config, nota_cambio: 'baja spot a 18 %' });

    expect(res.status).toBe(200);
    expect(svc.publicarConfiguracionComercial).toHaveBeenCalledWith(
      expect.objectContaining({ config, notaCambio: 'baja spot a 18 %', adminEmail: ADMIN }),
    );
    expect(invalidar).toHaveBeenCalledOnce();
    expect(((await res.json()) as { publicada: { version: number } }).publicada.version).toBe(3);
  });

  it('PUT con spot ≤ programada → 422 y no publica', async () => {
    const res = await buildApp(ADMIN).put({
      config: {
        ...CONFIGURACION_COMERCIAL_INICIAL,
        comisiones: { spot_pct: 10, programada_pct: 10 },
      },
      nota_cambio: 'empate',
    });
    expect(res.status).toBe(422);
    expect(svc.publicarConfiguracionComercial).not.toHaveBeenCalled();
  });

  it('PUT sin nota de cambio (ausente o en blanco) → 422', async () => {
    const { put } = buildApp(ADMIN);
    expect((await put({ config: CONFIGURACION_COMERCIAL_INICIAL })).status).toBe(422);
    expect(
      (await put({ config: CONFIGURACION_COMERCIAL_INICIAL, nota_cambio: '   ' })).status,
    ).toBe(422);
    expect(svc.publicarConfiguracionComercial).not.toHaveBeenCalled();
  });

  it('PUT con body no JSON → 400', async () => {
    const res = await buildApp(ADMIN).app.request('/admin/configuracion-comercial', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{x',
    });
    expect(res.status).toBe(400);
  });
});

describe('contrato programado (ADR-079 §2)', () => {
  const EMP = '00000000-0000-4000-8000-0000000000e1';

  it('GET lista generadores; fuera de la allowlist → 403', async () => {
    vi.mocked(cp.listarGeneradoresContratoProgramado).mockResolvedValueOnce([
      {
        empresaId: EMP,
        razonSocial: 'Gen SpA',
        rut: '76.000.000-K',
        activadoEn: null,
        activadoPor: null,
      },
    ]);
    const res = await buildApp(ADMIN).app.request(
      '/admin/configuracion-comercial/contrato-programado',
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { generadores: unknown[] }).generadores).toHaveLength(1);
    expect(
      (
        await buildApp('otro@x.cl').app.request(
          '/admin/configuracion-comercial/contrato-programado',
        )
      ).status,
    ).toBe(403);
  });

  it('PUT activa con el email del admin; empresa inexistente o no generadora → 404; body inválido → 422', async () => {
    const { app } = buildApp(ADMIN);
    const put = (id: string, body: unknown) =>
      app.request(`/admin/configuracion-comercial/contrato-programado/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    vi.mocked(cp.cambiarContratoProgramado).mockResolvedValueOnce({
      empresaId: EMP,
      razonSocial: 'Gen SpA',
      rut: '76.000.000-K',
      activadoEn: new Date(),
      activadoPor: ADMIN,
    });
    expect((await put(EMP, { activo: true })).status).toBe(200);
    expect(cp.cambiarContratoProgramado).toHaveBeenCalledWith(
      expect.objectContaining({ empresaId: EMP, activo: true, adminEmail: ADMIN }),
    );

    vi.mocked(cp.cambiarContratoProgramado).mockResolvedValueOnce(null);
    expect((await put(EMP, { activo: true })).status).toBe(404);
    expect((await put(EMP, { activo: 'si' })).status).toBe(422);
    expect((await put('no-uuid', { activo: true })).status).toBe(400);
  });
});
