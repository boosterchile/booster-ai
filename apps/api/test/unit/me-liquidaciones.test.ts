import { PRICING_METHODOLOGY_VERSION_V3 } from '@booster-ai/pricing-engine';
import { CLAVES_PRIVADAS_GENERADOR } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';

const leerPagoViaje = vi.fn();
vi.mock('../../src/services/mandato-cobro/eventos-pago.js', () => ({
  leerPagoViaje: (...a: unknown[]) => leerPagoViaje(...a),
}));
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
  appConfig.PRICING_V3_ACTIVATED = false;
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

  it('lista con liquidación → row con importes + status', async () => {
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
          createdAt: created,
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
    });
  });

  // ADR-069 / O-7: Booster ya no emite DTE. Los 5 campos `dte_*` se
  // mantienen en el response (deprecación escalonada) devolviendo `null`,
  // sin importar el status de la liquidación.
  it('dte_* deprecados → siempre null en el response', async () => {
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
          status: 'dte_emitido',
          createdAt: created,
          trackingCode: 'TRK-001',
        },
      ]),
    });
    const res = await app.request('/me/liquidaciones');
    const body = (await res.json()) as { liquidaciones: Array<Record<string, unknown>> };
    expect(body.liquidaciones[0]).toMatchObject({
      dte_folio: null,
      dte_emitido_en: null,
      dte_status: null,
      dte_pdf_url: null,
      dte_provider: null,
    });
  });
});

describe('GET /me/liquidaciones — v3 (ADR-079 §5)', () => {
  const FILA_V3 = {
    liquidacionId: 'liq-v3',
    asignacionId: 'asg-v3',
    montoBrutoClp: 700000,
    comisionPct: '20.00',
    comisionClp: 140000,
    ivaComisionClp: 26600,
    montoNetoCarrierClp: 700000,
    totalFacturaBoosterClp: 166600,
    precioTransportistaClp: 700000,
    pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
    status: 'lista_para_dte',
    createdAt: new Date('2026-10-08T11:00:00Z'),
    trackingCode: 'TRK-V3',
  };

  it('con solo v3 activo responde 200 (no 503)', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    appConfig.PRICING_V3_ACTIVATED = true;
    const app = buildApp({ withContext: true, db: makeDb([]) });
    const res = await app.request('/me/liquidaciones');
    expect(res.status).toBe(200);
  });

  it('fila v3 → solo el precio del transportista, sin comisión ni factura al generador', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const app = buildApp({ withContext: true, db: makeDb([FILA_V3]) });
    const res = await app.request('/me/liquidaciones');
    const body = (await res.json()) as { liquidaciones: Array<Record<string, unknown>> };
    const fila = body.liquidaciones[0] ?? {};
    expect(fila).toMatchObject({
      liquidacion_id: 'liq-v3',
      tracking_code: 'TRK-V3',
      precio_transportista_clp: 700000,
      monto_bruto_clp: 700000,
      monto_neto_carrier_clp: 700000,
      pricing_methodology_version: PRICING_METHODOLOGY_VERSION_V3,
    });
    for (const clave of [...CLAVES_PRIVADAS_GENERADOR, 'total_factura_booster_clp']) {
      expect(fila).not.toHaveProperty(clave);
    }
    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain('140000');
    expect(serializado).not.toContain('166600');
  });

  it('fila v2 junto a v3 conserva su desglose de comisión (contrato vigente al publicar)', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const app = buildApp({
      withContext: true,
      db: makeDb([
        FILA_V3,
        {
          ...FILA_V3,
          liquidacionId: 'liq-v2',
          comisionPct: '12.00',
          comisionClp: 24000,
          montoNetoCarrierClp: 176000,
          precioTransportistaClp: null,
          pricingMethodologyVersion: 'pricing-v2.0-cl-2026.06',
        },
      ]),
    });
    const res = await app.request('/me/liquidaciones');
    const body = (await res.json()) as { liquidaciones: Array<Record<string, unknown>> };
    expect(body.liquidaciones[1]).toMatchObject({ liquidacion_id: 'liq-v2', comision_pct: 12 });
  });
});

describe('GET /me/liquidaciones — mandato de cobro (ADR-080)', () => {
  const FILA = {
    liquidacionId: 'liq-m',
    asignacionId: 'asg-m',
    montoBrutoClp: 1_000_000,
    comisionPct: '20.00',
    comisionClp: 200_000,
    ivaComisionClp: 38_000,
    montoNetoCarrierClp: 1_000_000,
    totalFacturaBoosterClp: 238_000,
    precioTransportistaClp: 1_000_000,
    pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
    status: 'lista_para_dte',
    createdAt: new Date('2026-10-10T11:00:00Z'),
    trackingCode: 'TRK-M',
  };

  it('fila en mandato: muestra la liberación al transportista, nunca el cobro al generador', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    leerPagoViaje.mockResolvedValue({
      modo_flujo: 'mandato_cobro',
      cobro: {
        estado: 'pendiente',
        en: null,
        monto_clp: null,
        vence_en: '2026-11-09T12:00:00.000Z',
      },
      liberacion: {
        estado: 'pendiente',
        en: null,
        monto_clp: null,
        vence_en: '2026-10-15T12:00:00.000Z',
      },
      montos_esperados: { cobro_clp: 1_238_000, liberacion_clp: 1_000_000 },
    });
    const app = buildApp({
      withContext: true,
      db: makeDb([{ ...FILA, modoFlujo: 'mandato_cobro' }]),
    });
    const body = (await (await app.request('/me/liquidaciones')).json()) as {
      liquidaciones: Array<Record<string, unknown>>;
    };
    expect(body.liquidaciones[0]).toMatchObject({
      modo_flujo: 'mandato_cobro',
      liberacion: {
        estado: 'pendiente',
        en: null,
        monto_clp: null,
        vence_en: '2026-10-15T12:00:00.000Z',
      },
    });
    const serializado = JSON.stringify(body);
    expect(serializado).not.toContain('1238000');
    expect(serializado).not.toContain('"cobro":');
    expect(serializado).not.toContain('montos_esperados');
    expect(leerPagoViaje).toHaveBeenCalledWith(expect.anything(), 'asg-m');
  });

  it('fila conector: modo_flujo sin bloque de liberación ni lectura de eventos', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    leerPagoViaje.mockClear();
    const app = buildApp({ withContext: true, db: makeDb([{ ...FILA, modoFlujo: 'conector' }]) });
    const body = (await (await app.request('/me/liquidaciones')).json()) as {
      liquidaciones: Array<Record<string, unknown>>;
    };
    expect(body.liquidaciones[0]).toMatchObject({ modo_flujo: 'conector' });
    expect(body.liquidaciones[0]).not.toHaveProperty('liberacion');
    expect(leerPagoViaje).not.toHaveBeenCalled();
  });
});
