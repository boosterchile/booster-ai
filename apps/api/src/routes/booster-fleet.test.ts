import type { Logger } from '@booster-ai/logger';
import { componerPanelBoosterFleet } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoosterFleetRoutes } from './booster-fleet.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const VEHICULO = '11111111-1111-4111-8111-111111111111';
const MANTENCION = '33333333-3333-4333-8333-333333333333';

const solicitudesAbiertasDeEmpresa = vi.hoisted(() => vi.fn(async () => []));
vi.mock('../services/solicitudes-booster.js', () => ({ solicitudesAbiertasDeEmpresa }));

vi.mock('../services/booster-fleet.js', () => ({
  armarPanelBoosterFleet: vi.fn(),
  programarMantencion: vi.fn(),
  cerrarMantencion: vi.fn(),
}));

const { armarPanelBoosterFleet, programarMantencion, cerrarMantencion } = await import(
  '../services/booster-fleet.js'
);

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

function appDe(
  ctx: { rol?: string; transportista?: boolean; noUser?: boolean; noEmpresa?: boolean } = {},
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (!ctx.noUser) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'caller' },
        activeMembership: ctx.noEmpresa
          ? null
          : {
              membership: {
                id: 'm-1',
                empresaId: EMPRESA,
                role: ctx.rol ?? 'dueno',
                status: 'activa',
              },
              empresa: {
                id: EMPRESA,
                isTransportista: ctx.transportista ?? true,
                status: 'activa',
              },
            },
      });
    }
    await next();
  });
  app.route(
    '/',
    createBoosterFleetRoutes({
      db: {} as never,
      logger,
      ahora: () => new Date('2026-11-17T15:00:00.000Z'),
    }),
  );
  return app;
}

const panel = componerPanelBoosterFleet({
  hoy: '2026-11-17',
  desde: '2026-11-10T15:00:00.000Z',
  hasta: '2026-11-17T15:00:00.000Z',
  truncado: false,
  mantencionesTruncadas: false,
  vehiculos: [],
  trayectos: [],
  documentosVehiculo: [],
  conductores: [],
  documentosConductor: [],
  mantenciones: [],
});

const mantencion = {
  id: MANTENCION,
  vehiculo_id: VEHICULO,
  patente: 'AAAA11',
  tipo: 'preventiva' as const,
  titulo: 'Cambio de aceite',
  programada_para: '2026-12-20',
  kilometraje_objetivo: null,
  estado: 'programada' as const,
  realizada_en: null,
  notas: null,
};

beforeEach(() => {
  vi.mocked(armarPanelBoosterFleet).mockReset();
  vi.mocked(programarMantencion).mockReset();
  vi.mocked(cerrarMantencion).mockReset();
});

describe('GET /booster-fleet', () => {
  it('sin sesión responde 401', async () => {
    const res = await appDe({ noUser: true }).request('/');
    expect(res.status).toBe(401);
  });

  it('sin empresa, sin ser transportista o sin rol de dueño responde 403', async () => {
    expect((await appDe({ noEmpresa: true }).request('/')).status).toBe(403);
    expect((await appDe({ transportista: false }).request('/')).status).toBe(403);
    expect((await appDe({ rol: 'despachador' }).request('/')).status).toBe(403);
    expect(armarPanelBoosterFleet).not.toHaveBeenCalled();
  });

  it('el dueño recibe el panel Booster Fleet', async () => {
    vi.mocked(armarPanelBoosterFleet).mockResolvedValue(panel);
    const res = await appDe().request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { configuracion: { nombre: string } };
    expect(body.configuracion.nombre).toBe('Booster Fleet');
    expect(armarPanelBoosterFleet).toHaveBeenCalledWith(
      expect.objectContaining({ combustibleGuardado: false }),
    );
  });

  it('trae las solicitudes a Booster abiertas para mostrarlas pedidas al recargar', async () => {
    vi.mocked(armarPanelBoosterFleet).mockResolvedValue(panel);
    solicitudesAbiertasDeEmpresa.mockResolvedValueOnce([
      { vehiculoId: '11111111-1111-4111-8111-111111111111', tipo: 'configurar_fuente_combustible' },
    ] as never);
    const res = await appDe().request('/');
    const body = (await res.json()) as {
      solicitudes_booster_abiertas: Array<{ vehiculo_id: string; tipo: string }>;
    };
    expect(body.solicitudes_booster_abiertas).toEqual([
      {
        vehiculo_id: '11111111-1111-4111-8111-111111111111',
        tipo: 'configurar_fuente_combustible',
      },
    ]);
  });

  it('con combustible=guardada acepta la lectura guardada', async () => {
    vi.mocked(armarPanelBoosterFleet).mockResolvedValue(panel);
    const res = await appDe().request('/?combustible=guardada');
    expect(res.status).toBe(200);
    expect(armarPanelBoosterFleet).toHaveBeenCalledWith(
      expect.objectContaining({ combustibleGuardado: true }),
    );
  });

  it('un valor desconocido en combustible responde 400 sin leer nada', async () => {
    const res = await appDe().request('/?combustible=cualquiera');
    expect(res.status).toBe(400);
    expect(armarPanelBoosterFleet).not.toHaveBeenCalled();
  });
});

describe('mantenciones', () => {
  it('un cuerpo inválido responde 400', async () => {
    const res = await appDe().request('/mantenciones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ titulo: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('programa y responde 201', async () => {
    vi.mocked(programarMantencion).mockResolvedValue({ ok: true, mantencion });
    const res = await appDe({ rol: 'admin' }).request('/mantenciones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vehiculo_id: VEHICULO,
        tipo: 'preventiva',
        titulo: 'Cambio de aceite',
        programada_para: '2026-12-20',
      }),
    });
    expect(res.status).toBe(201);
    expect(programarMantencion).toHaveBeenCalledOnce();
  });

  it('un vehículo ajeno responde 404', async () => {
    vi.mocked(programarMantencion).mockResolvedValue({
      ok: false,
      code: 'vehiculo_no_encontrado',
    });
    const res = await appDe().request('/mantenciones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vehiculo_id: VEHICULO,
        tipo: 'preventiva',
        titulo: 'Cambio de aceite',
        programada_para: '2026-12-20',
      }),
    });
    expect(res.status).toBe(404);
    const prohibido = await appDe({ rol: 'despachador' }).request('/mantenciones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vehiculo_id: VEHICULO,
        tipo: 'preventiva',
        titulo: 'Cambio de aceite',
        programada_para: '2026-12-20',
      }),
    });
    expect(prohibido.status).toBe(403);
  });

  it('realizar responde 200, 409 o 404 según el cierre', async () => {
    vi.mocked(cerrarMantencion).mockResolvedValueOnce({
      ok: true,
      mantencion: { ...mantencion, estado: 'realizada' },
    });
    const ok = await appDe().request(`/mantenciones/${MANTENCION}/realizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(ok.status).toBe(200);

    vi.mocked(cerrarMantencion).mockResolvedValueOnce({ ok: false, code: 'ya_cerrada' });
    const conflicto = await appDe().request(`/mantenciones/${MANTENCION}/realizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kilometraje_realizado: 10 }),
    });
    expect(conflicto.status).toBe(409);

    vi.mocked(cerrarMantencion).mockResolvedValueOnce({ ok: false, code: 'no_encontrada' });
    const falta = await appDe().request(`/mantenciones/${MANTENCION}/realizar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(falta.status).toBe(404);

    const prohibido = await appDe({ rol: 'despachador' }).request(
      `/mantenciones/${MANTENCION}/realizar`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(prohibido.status).toBe(403);
  });

  it('cancelar responde 200 y un despachador no puede', async () => {
    vi.mocked(cerrarMantencion).mockResolvedValue({ ok: true, mantencion: null });
    const res = await appDe().request(`/mantenciones/${MANTENCION}/cancelar`, { method: 'POST' });
    expect(res.status).toBe(200);
    const prohibido = await appDe({ rol: 'visualizador' }).request(
      `/mantenciones/${MANTENCION}/cancelar`,
      { method: 'POST' },
    );
    expect(prohibido.status).toBe(403);
  });
});
