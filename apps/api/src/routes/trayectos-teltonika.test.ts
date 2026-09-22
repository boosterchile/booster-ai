import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createTrayectosTeltonikaRoutes } from './trayectos-teltonika.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const VEHICULO = '11111111-1111-4111-8111-111111111111';

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

function cadena(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(async () => rows);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeDb(vehiculos: unknown[], puntos: unknown[] = []) {
  let llamadas = 0;
  return {
    select: vi.fn(() => {
      llamadas += 1;
      return cadena(llamadas === 1 ? vehiculos : puntos);
    }),
  } as never;
}

function buildApp(
  db: ReturnType<typeof makeDb>,
  ctx: {
    rol?: string;
    transportista?: boolean;
    noUser?: boolean;
    noEmpresa?: boolean;
  } = {},
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
  app.route('/', createTrayectosTeltonikaRoutes({ db, logger }));
  return app;
}

describe('GET /trayectos-teltonika', () => {
  it('401 sin usuario', async () => {
    const res = await buildApp(makeDb([]), { noUser: true }).request('/');
    expect(res.status).toBe(401);
  });

  it('403 al conductor, al despachador y a un generador puro', async () => {
    for (const rol of ['conductor', 'despachador', 'visualizador'] as const) {
      const res = await buildApp(makeDb([]), { rol }).request('/');
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe('rol_no_autorizado');
    }
    const generador = await buildApp(makeDb([]), { rol: 'dueno', transportista: false }).request(
      '/',
    );
    expect(generador.status).toBe(403);
    expect(((await generador.json()) as { code: string }).code).toBe('no_es_transportista');
  });

  it('200 vacío con CTA si la empresa no tiene Teltonika', async () => {
    const res = await buildApp(makeDb([])).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cta: string;
      trayectos: unknown[];
      empresa_id: string;
      total: number;
    };
    expect(body.cta).toBe('vincular_teltonika');
    expect(body.trayectos).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.empresa_id).toBe(EMPRESA);
  });

  it('200 con el trayecto de la empresa, reciente y sin litros inventados', async () => {
    const t0 = new Date('2026-09-02T12:00:00.000Z');
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 60_000),
          latitude: '-33.46',
          longitude: '-70.66',
          speedKmh: 50,
          ioData: { '239': 1, '240': 1, '84': 400 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: t0,
          latitude: '-33.45',
          longitude: '-70.66',
          speedKmh: 50,
          ioData: { '239': 1, '240': 1, '84': 500 },
        },
      ],
    );
    const res = await buildApp(db, { rol: 'admin' }).request('/?page=1&page_size=20');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      cta: null;
      trayectos: Array<{
        patente: string;
        empresa_id: string;
        distancia_km: number;
        litros_iniciales: number;
        litros_finales: number;
        km_por_litro: number;
        posible_robo_combustible: boolean;
        inicio: string;
        fin: string;
      }>;
    };
    expect(body.cta).toBeNull();
    expect(body.total).toBe(1);
    expect(body.trayectos[0]).toMatchObject({
      patente: 'ABCD12',
      empresa_id: EMPRESA,
      litros_iniciales: 50,
      litros_finales: 40,
      posible_robo_combustible: false,
      event_lat: null,
      event_lon: null,
    });
    expect(body.trayectos[0]?.distancia_km).toBeGreaterThan(0);
    expect(body.trayectos[0]?.km_por_litro).toBeGreaterThan(0);
    expect(Date.parse(body.trayectos[0]?.fin ?? '')).toBeGreaterThan(
      Date.parse(body.trayectos[0]?.inicio ?? ''),
    );
  });

  it('con badge devuelve el pin del inicio de la ventana de caída', async () => {
    const t0 = new Date('2026-09-02T12:00:00.000Z');
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 12 * 60_000),
          latitude: '-33.48',
          longitude: '-70.70',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 590 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 60_000),
          latitude: '-33.451',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 790 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 10 * 60_000),
          latitude: '-33.40',
          longitude: '-70.60',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: t0,
          latitude: '-33.45',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 800 },
        },
      ],
    );
    const res = await buildApp(db, { rol: 'dueno' }).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trayectos: Array<{
        posible_robo_combustible: boolean;
        event_lat: number | null;
        event_lon: number | null;
      }>;
    };
    expect(body.trayectos[0]).toMatchObject({
      posible_robo_combustible: true,
      event_lat: -33.4,
      event_lon: -70.6,
    });
  });

  it('con badge y sin fix en la ventana devuelve event_lat y event_lon nulos', async () => {
    const t0 = new Date('2026-09-02T12:00:00.000Z');
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 12 * 60_000),
          latitude: null,
          longitude: null,
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 590 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 10 * 60_000),
          latitude: '0',
          longitude: '0',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0.getTime() + 60_000),
          latitude: '-33.451',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 790 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: t0,
          latitude: '-33.45',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 800 },
        },
      ],
    );
    const res = await buildApp(db, { rol: 'admin' }).request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      trayectos: Array<{
        posible_robo_combustible: boolean;
        event_lat: number | null;
        event_lon: number | null;
      }>;
    };
    expect(body.trayectos[0]).toMatchObject({
      posible_robo_combustible: true,
      event_lat: null,
      event_lon: null,
    });
  });

  it('422 si la ventana supera 31 días', async () => {
    const res = await buildApp(makeDb([])).request(
      '/?desde=2026-01-01T00:00:00.000Z&hasta=2026-03-01T00:00:00.000Z',
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('ventana_demasiado_amplia');
  });
});
