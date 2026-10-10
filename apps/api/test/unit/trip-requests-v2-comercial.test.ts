import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';

/**
 * ADR-079 §1–§2 en la publicación de cargas: modalidad, contrato programado,
 * tasa congelada con PRICING_V3_ACTIVATED y desglose solo para el generador.
 */
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

vi.mock('../../src/services/matching.js', () => ({
  runMatching: vi.fn(async () => ({
    tripId: 'trip-1',
    candidatesEvaluated: 0,
    offersCreated: 0,
    offers: [],
  })),
  TripRequestNotFoundError: class extends Error {},
  TripRequestNotMatchableError: class extends Error {},
}));
vi.mock('../../src/services/geocodificar-origen.js', () => ({ geocodificarOrigen: vi.fn() }));

const { config: appConfig } = await import('../../src/config.js');
const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

const VERSION_ID = '00000000-0000-4000-8000-0000000000c1';
const lector = {
  obtener: vi.fn(async () => ({
    id: VERSION_ID,
    version: 1,
    config: CONFIGURACION_COMERCIAL_INICIAL,
    vigenteDesde: new Date(),
    notaCambio: 'v1',
    creadoPorEmail: 'sistema@boosterchile.com',
    creadoEn: new Date(),
  })),
  invalidar: vi.fn(),
};

function body(extra: Record<string, unknown> = {}) {
  const start = Date.now() + 24 * 3_600_000;
  return {
    origin: { address_raw: 'Av. Apoquindo 5550', region_code: 'XIII' },
    destination: { address_raw: 'Concepción centro', region_code: 'VIII' },
    cargo: { cargo_type: 'carga_seca', weight_kg: 1500 },
    pickup_window: {
      start_at: new Date(start).toISOString(),
      end_at: new Date(start + 10 * 3_600_000).toISOString(),
    },
    proposed_price_clp: 250_000,
    ...extra,
  };
}

function setup(opts: { contratoProgramado?: boolean } = {}) {
  const insertados: Record<string, unknown>[] = [];
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertados.push(v);
        return {
          returning: vi.fn(async () => [{ id: 'trip-1', trackingCode: 'BOO-1', ...v }]),
        };
      }),
    })),
  } as never as Db;
  const empresa = {
    id: 'emp-1',
    isGeneradorCarga: true,
    status: 'activa',
    contratoProgramadoActivadoEn: opts.contratoProgramado ? new Date() : null,
  };
  const app = new Hono();
  app.use('/trip-requests-v2/*', async (c, next) => {
    c.set(
      'userContext' as never,
      {
        user: { id: 'user-1' },
        memberships: [],
        activeMembership: { membership: { role: 'dueno' }, empresa },
      } as never,
    );
    await next();
  });
  app.route(
    '/trip-requests-v2',
    createTripRequestsV2Routes({ db, logger, lectorComercial: lector }),
  );
  const post = (b: unknown) =>
    app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    });
  return { app, post, insertados };
}

afterEach(() => {
  appConfig.PRICING_V3_ACTIVATED = false;
  vi.clearAllMocks();
});

describe('POST /trip-requests-v2 — modelo comercial v3', () => {
  it('programada sin contrato programado habilitado → 422 y no inserta', async () => {
    const { post, insertados } = setup();
    const res = await post(body({ modalidad_carga: 'programada' }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: 'contrato_programado_no_habilitado' });
    expect(insertados).toHaveLength(0);
  });

  it('flag apagado: guarda la modalidad (spot por defecto), no congela tasa ni muestra desglose', async () => {
    const { post, insertados } = setup();
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(insertados[0]).toMatchObject({ modalidadCarga: 'spot' });
    expect(insertados[0]).not.toHaveProperty('comisionPctAplicada');
    expect(lector.obtener).not.toHaveBeenCalled();
    expect((await res.json()) as Record<string, unknown>).not.toHaveProperty('comercial');
  });

  it('flag encendido: congela tasa y versión, y devuelve el desglose al generador', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { post, insertados } = setup({ contratoProgramado: true });
    const res = await post(body({ modalidad_carga: 'programada' }));
    expect(res.status).toBe(201);
    expect(insertados[0]).toMatchObject({
      modalidadCarga: 'programada',
      comisionPctAplicada: '10.00',
      configuracionComercialId: VERSION_ID,
    });
    expect(((await res.json()) as { comercial: unknown }).comercial).toEqual({
      modalidad_carga: 'programada',
      precio_transportista_clp: 250_000,
      comision_pct: 10,
      comision_clp: 25_000,
      iva_comision_clp: 4_750,
      precio_generador_clp: 275_000,
      total_factura_generador_clp: 29_750,
    });
  });

  it('flag encendido sin precio propuesto: congela la tasa, desglose null', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { post, insertados } = setup();
    const res = await post(body({ proposed_price_clp: null }));
    expect(insertados[0]).toMatchObject({ comisionPctAplicada: '20.00' });
    expect(((await res.json()) as { comercial: unknown }).comercial).toBeNull();
  });
});

describe('GET /trip-requests-v2/cotizacion', () => {
  const get = (app: Hono, q: string) => app.request(`/trip-requests-v2/cotizacion?${q}`);

  it('flag apagado → 404 pricing_v3_disabled', async () => {
    const res = await get(setup().app, 'precio_transportista_clp=700000&modalidad_carga=spot');
    expect(res.status).toBe(404);
  });

  it('flag encendido → desglose con la configuración vigente y si programada está disponible', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const res = await get(setup().app, 'precio_transportista_clp=700000&modalidad_carga=spot');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      configuracion_version: 1,
      programada_disponible: false,
      desglose: {
        modalidad_carga: 'spot',
        precio_transportista_clp: 700_000,
        comision_pct: 20,
        comision_clp: 140_000,
        iva_comision_clp: 26_600,
        precio_generador_clp: 840_000,
        total_factura_generador_clp: 166_600,
      },
    });
  });

  it('programada sin contrato → 422; query inválida → 400', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { app } = setup();
    expect((await get(app, 'precio_transportista_clp=1&modalidad_carga=programada')).status).toBe(
      422,
    );
    expect((await get(app, 'precio_transportista_clp=-5&modalidad_carga=spot')).status).toBe(400);
  });
});
