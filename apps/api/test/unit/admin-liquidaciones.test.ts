import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { createAdminLiquidacionesRoutes } from '../../src/routes/admin-liquidaciones.js';
import type { UserContext } from '../../src/services/user-context.js';

vi.mock('../../src/services/emitir-dte-liquidacion.js', () => ({
  emitirDteLiquidacion: vi.fn(),
}));

const { emitirDteLiquidacion } = await import('../../src/services/emitir-dte-liquidacion.js');

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

const ADMIN_EMAIL = 'dev@boosterchile.com';

function makeUserCtx(email: string): UserContext {
  return {
    user: { id: 'u1', firebaseUid: 'fb1', fullName: 'F', email },
    activeMembership: {
      id: 'm1',
      role: 'dueno',
      status: 'activa',
      empresa: {
        id: 'e1',
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

function buildApp(opts: { withContext: boolean; email?: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.withContext) {
      c.set('userContext', makeUserCtx(opts.email ?? ADMIN_EMAIL));
    }
    await next();
  });
  app.route(
    '/admin/liquidaciones',
    createAdminLiquidacionesRoutes({ db: {} as never, logger: noopLogger }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.PRICING_V2_ACTIVATED = true;
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN_EMAIL];
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/liquidaciones/:id/emitir-dte — gating', () => {
  it('flag PRICING_V2 off → 503', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('sin userContext → 401', async () => {
    const app = buildApp({ withContext: false });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('email no en allowlist → 403', async () => {
    const app = buildApp({ withContext: true, email: 'rando@example.com' });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/liquidaciones/:id/emitir-dte — service mapping', () => {
  it('liquidacion_not_found → 404', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'liquidacion_not_found',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('empresa_carrier_not_found → 404', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'empresa_carrier_not_found',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('skipped → 200 con reason', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'skipped',
      reason: 'no_adapter',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: true, reason: 'no_adapter' });
  });

  it('ya_emitido → 200 con folio + already_emitted', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ya_emitido',
      folio: 'folio-99',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already_emitted: true, folio: 'folio-99' });
  });

  it('validation_error → 422', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'validation_error',
      message: 'RUT inválido',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(422);
  });

  it('transient_error → 503 (caller debe reintentar)', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'transient_error',
      message: 'timeout',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('provider_rejected → 502', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'provider_rejected',
      providerCode: '400',
      message: 'cert expirado',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { provider_code: string };
    expect(body.provider_code).toBe('400');
  });

  it('emitido → 201 con folio + factura_id', async () => {
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'emitido',
      folio: 'folio-new-1234',
      facturaId: 'factura-1',
      providerTrackId: 'track-abc',
    });
    const app = buildApp({ withContext: true });
    const res = await app.request('/admin/liquidaciones/liq-1/emitir-dte', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      folio: 'folio-new-1234',
      factura_id: 'factura-1',
      provider_track_id: 'track-abc',
    });
  });
});
