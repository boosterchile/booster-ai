import {
  CLAVES_PRIVADAS_GENERADOR,
  CONFIGURACION_COMERCIAL_INICIAL,
} from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const { config: appConfig } = await import('../../src/config.js');
const { createPublicPreciosRoutes } = await import('../../src/routes/public-precios.js');
const { SinConfiguracionPublicadaError } = await import(
  '../../src/services/configuracion-comercial.js'
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

const VIGENTE = {
  id: '00000000-0000-4000-8000-000000000001',
  version: 4,
  config: CONFIGURACION_COMERCIAL_INICIAL,
  vigenteDesde: new Date('2026-10-08T12:00:00.000Z'),
  notaCambio: 'nota interna que no se publica',
  creadoPorEmail: 'admin@boosterchile.com',
  creadoEn: new Date('2026-10-08T12:00:00.000Z'),
};

function buildApp(obtener = vi.fn(async () => VIGENTE)) {
  const app = new Hono();
  app.route(
    '/public',
    createPublicPreciosRoutes({ logger, lector: { obtener, invalidar: vi.fn() } }),
  );
  return { app, obtener };
}

afterEach(() => {
  appConfig.PRICING_V3_ACTIVATED = false;
});

describe('GET /public/precios (T10-29, ADR-079 §4)', () => {
  it('v3 apagado → 404 precios_no_publicados (rige el contrato v2)', async () => {
    const { app, obtener } = buildApp();
    const res = await app.request('/public/precios');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'precios_no_publicados' });
    expect(obtener).not.toHaveBeenCalled();
  });

  it('v3 encendido → solo servicios de la versión publicada, cacheable', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const res = await buildApp().app.request('/public/precios');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await res.json()).toEqual({
      version: 4,
      vigente_desde: '2026-10-08T12:00:00.000Z',
      servicios: CONFIGURACION_COMERCIAL_INICIAL.servicios,
    });
  });

  it('nunca expone comisiones, financiamiento, impuestos ni datos internos', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const texto = await (await buildApp().app.request('/public/precios')).text();
    for (const clave of [
      ...CLAVES_PRIVADAS_GENERADOR,
      'comisiones',
      'spot_pct',
      'programada_pct',
      'financiamiento',
      'impuestos',
      'nota_cambio',
      'notaCambio',
      'admin@boosterchile.com',
    ]) {
      expect(texto).not.toContain(clave);
    }
  });

  it('sin versión publicada → 503', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { app } = buildApp(
      vi.fn(async () => {
        throw new SinConfiguracionPublicadaError();
      }),
    );
    const res = await app.request('/public/precios');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'sin_configuracion_publicada' });
  });

  it('otro error de lectura se propaga', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { app } = buildApp(
      vi.fn(async () => {
        throw new Error('db caída');
      }),
    );
    expect((await app.request('/public/precios')).status).toBe(500);
  });
});
