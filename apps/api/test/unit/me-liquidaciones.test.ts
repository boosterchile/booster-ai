import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { createMeLiquidacionesRoutes } from '../../src/routes/me-liquidaciones.js';
import type { UserContext } from '../../src/services/user-context.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

const EMPRESA_CARRIER_ID = '11111111-1111-1111-1111-111111111111';

function makeCarrierCtx(): UserContext {
  return {
    user: { id: 'u1', firebaseUid: 'fb1', fullName: 'F', email: 'f@x.cl' },
    activeMembership: {
      id: 'm1',
      role: 'dueno',
      status: 'activa',
      empresa: {
        id: EMPRESA_CARRIER_ID,
        legalName: 'E',
        rut: '76',
        isGeneradorCarga: false,
        isTransportista: true,
        status: 'activa',
      },
    },
    memberships: [],
  } as unknown as UserContext;
}

function makeShipperCtx(): UserContext {
  const ctx = makeCarrierCtx();
  (ctx.activeMembership as { empresa: { isTransportista: boolean } }).empresa.isTransportista =
    false;
  return ctx;
}

function makeDb(rows: Array<Record<string, unknown>>) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };
  return {
    select: vi.fn(() => chain),
  };
}

function buildApp(opts: { withContext: boolean; isCarrier?: boolean; db?: unknown }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.withContext) {
      c.set('userContext', opts.isCarrier === false ? makeShipperCtx() : makeCarrierCtx());
    }
    await next();
  });
  app.route(
    '/me',
    createMeLiquidacionesRoutes({ db: (opts.db ?? {}) as never, logger: noopLogger }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.PRICING_V2_ACTIVATED = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /me/liquidaciones — gating', () => {
  it('flag off → 503', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const app = buildApp({ withContext: true });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(503);
  });

  it('sin userContext → 400', async () => {
    const app = buildApp({ withContext: false });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(400);
  });

  it('empresa no es transportista → 403', async () => {
    const app = buildApp({ withContext: true, isCarrier: false });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_no_transportista' });
  });
});

describe('GET /me/liquidaciones — lista', () => {
  it('lista vacía → 200 con liquidaciones:[]', async () => {
    const app = buildApp({ withContext: true, db: makeDb([]) });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liquidaciones: [] });
  });

  it('lista con liquidación sin DTE → row sin folio', async () => {
    const created = new Date('2026-05-10T11:00:00Z');
    const app = buildApp({
      withContext: true,
      db: makeDb([
        {
          liquidacionId: 'liq-1',
          asignacionId: 'asg-1',
          montoBrutoClp: 200000,
          comisionPct: '12.00',
          comisionClp: 24000,
          ivaComisionClp: 4560,
          montoNetoCarrierClp: 176000,
          totalFacturaBoosterClp: 28560,
          pricingMethodologyVersion: 'pricing-v2.0-cl-2026.06',
          status: 'lista_para_dte',
          dteFolio: null,
          dteEmitidoEn: null,
          createdAt: created,
          facturaId: null,
          dteStatus: null,
          dtePdfUrl: null,
          dteProvider: null,
          trackingCode: 'TRK-001',
        },
      ]),
    });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { liquidaciones: Array<Record<string, unknown>> };
    expect(body.liquidaciones).toHaveLength(1);
    expect(body.liquidaciones[0]).toMatchObject({
      liquidacion_id: 'liq-1',
      tracking_code: 'TRK-001',
      monto_bruto_clp: 200000,
      comision_pct: 12,
      monto_neto_carrier_clp: 176000,
      status: 'lista_para_dte',
      dte_folio: null,
      dte_status: null,
    });
  });

  it('lista con liquidación DTE emitido → folio + pdf_url + dte_status', async () => {
    const created = new Date('2026-05-10T11:00:00Z');
    const emitido = new Date('2026-05-10T11:01:00Z');
    const app = buildApp({
      withContext: true,
      db: makeDb([
        {
          liquidacionId: 'liq-1',
          asignacionId: 'asg-1',
          montoBrutoClp: 200000,
          comisionPct: '12.00',
          comisionClp: 24000,
          ivaComisionClp: 4560,
          montoNetoCarrierClp: 176000,
          totalFacturaBoosterClp: 28560,
          pricingMethodologyVersion: 'pricing-v2.0-cl-2026.06',
          status: 'dte_emitido',
          dteFolio: '1234',
          dteEmitidoEn: emitido,
          createdAt: created,
          facturaId: 'fact-1',
          dteStatus: 'aceptado',
          dtePdfUrl: 'https://mock.dte/1234.pdf',
          dteProvider: 'mock',
          trackingCode: 'TRK-001',
        },
      ]),
    });
    const res = await app.request('/me/liquidaciones');
    const body = (await res.json()) as { liquidaciones: Array<Record<string, unknown>> };
    expect(body.liquidaciones[0]).toMatchObject({
      dte_folio: '1234',
      dte_emitido_en: emitido.toISOString(),
      dte_status: 'aceptado',
      dte_pdf_url: 'https://mock.dte/1234.pdf',
      dte_provider: 'mock',
    });
  });
});
