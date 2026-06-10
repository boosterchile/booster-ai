import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { createAdminCobraHoyRoutes } from '../../src/routes/admin-cobra-hoy.js';
import type { UserContext } from '../../src/services/user-context.js';

/**
 * Tests HTTP de admin-cobra-hoy. Mockean Drizzle chain (select / update)
 * y validan: flag gating, allowlist por email, transiciones legales/
 * ilegales, mapeo de timestamps `desembolsado_en` / `cobrado_a_shipper_en`.
 */

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

const ADMIN_EMAIL = 'dev@boosterchile.com';
const NON_ADMIN_EMAIL = 'random@example.com';

function makeUserCtx(email: string): UserContext {
  return {
    user: { id: 'u1', firebaseUid: 'fb1', fullName: 'Felipe', email },
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

function makeApp(opts: {
  withContext: boolean;
  email?: string;
  selectRows?: Array<Record<string, unknown>>;
  updateRows?: Array<Record<string, unknown>>;
  /**
   * Cola para múltiples updates en el mismo request (transición +
   * exposición crediticia). Tiene precedencia sobre updateRows.
   */
  updateRowsSeq?: Array<Array<Record<string, unknown>>>;
}) {
  const selectQueue: Array<Array<Record<string, unknown>>> = [];
  if (opts.selectRows) {
    selectQueue.push(opts.selectRows);
  }
  const updateQueue: Array<Array<Record<string, unknown>>> = [];
  if (opts.updateRowsSeq) {
    updateQueue.push(...opts.updateRowsSeq);
  } else if (opts.updateRows) {
    updateQueue.push(opts.updateRows);
  }

  // Captura los args de cada .set() para asertar el update de exposición.
  const updateSetCalls: Array<Record<string, unknown>> = [];

  const selectChain: Record<string, unknown> = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    orderBy: vi.fn(() => selectChain),
    limit: vi.fn(async () => selectQueue.shift() ?? []),
  };
  const updateChain = {
    set: vi.fn((args: Record<string, unknown>) => {
      updateSetCalls.push(args);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => updateQueue.shift() ?? []),
        })),
      };
    }),
  };
  const updateFn = vi.fn(() => updateChain);
  const db = {
    select: vi.fn(() => selectChain),
    update: updateFn,
    // La transición corre dentro de db.transaction(tx => ...).
    transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) =>
      cb({ select: vi.fn(() => selectChain), update: updateFn }),
    ),
  };

  const warnSpy = vi.fn();
  const logger = { ...(noopLogger as Record<string, unknown>), warn: warnSpy } as never;

  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.withContext) {
      c.set('userContext', makeUserCtx(opts.email ?? ADMIN_EMAIL));
    }
    await next();
  });
  app.route('/admin/cobra-hoy', createAdminCobraHoyRoutes({ db: db as never, logger }));
  return { app, db, updateSetCalls, warnSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.FACTORING_V1_ACTIVATED = true;
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN_EMAIL];
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /admin/cobra-hoy/adelantos — gating', () => {
  it('flag off → 503', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const { app } = makeApp({ withContext: true });
    const res = await app.request('/admin/cobra-hoy/adelantos');
    expect(res.status).toBe(503);
  });

  it('sin userContext → 401', async () => {
    const { app } = makeApp({ withContext: false });
    const res = await app.request('/admin/cobra-hoy/adelantos');
    expect(res.status).toBe(401);
  });

  it('email no en allowlist → 403 forbidden_platform_admin', async () => {
    const { app } = makeApp({ withContext: true, email: NON_ADMIN_EMAIL });
    const res = await app.request('/admin/cobra-hoy/adelantos');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_platform_admin' });
  });

  it('email en allowlist + lista vacía → 200', async () => {
    const { app } = makeApp({ withContext: true, selectRows: [] });
    const res = await app.request('/admin/cobra-hoy/adelantos');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adelantos: [] });
  });
});

describe('GET /admin/cobra-hoy/adelantos — filtros', () => {
  it('status inválido → 400 invalid_status', async () => {
    const { app } = makeApp({ withContext: true });
    const res = await app.request('/admin/cobra-hoy/adelantos?status=basura');
    expect(res.status).toBe(400);
  });

  it('status válido + carrier_id → invoca select con filtros + serializa', async () => {
    const created = new Date('2026-05-10T10:00:00Z');
    const { app } = makeApp({
      withContext: true,
      selectRows: [
        {
          id: 'a1',
          asignacionId: 'asg-1',
          liquidacionId: 'liq-1',
          empresaCarrierId: 'car-1',
          empresaShipperId: 'shi-1',
          montoNetoClp: 176000,
          plazoDiasShipper: 30,
          tarifaPct: '1.50',
          tarifaClp: 2640,
          montoAdelantadoClp: 173360,
          status: 'solicitado',
          factoringMethodologyVersion: 'factoring-v1.0-cl-2026.06',
          desembolsadoEn: null,
          cobradoAShipperEn: null,
          notasAdmin: null,
          createdAt: created,
        },
      ],
    });
    const res = await app.request(
      '/admin/cobra-hoy/adelantos?status=solicitado&empresa_carrier_id=car-1',
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adelantos: Array<Record<string, unknown>> };
    expect(body.adelantos).toHaveLength(1);
    expect(body.adelantos[0]).toMatchObject({
      id: 'a1',
      asignacion_id: 'asg-1',
      tarifa_pct: 1.5,
      status: 'solicitado',
      creado_en: created.toISOString(),
      desembolsado_en: null,
      cobrado_a_shipper_en: null,
    });
  });
});

describe('POST /admin/cobra-hoy/adelantos/:id/transicionar', () => {
  it('flag off → 503', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const { app } = makeApp({ withContext: true });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'aprobado' }),
    });
    expect(res.status).toBe(503);
  });

  it('non-admin → 403', async () => {
    const { app } = makeApp({ withContext: true, email: NON_ADMIN_EMAIL });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'aprobado' }),
    });
    expect(res.status).toBe(403);
  });

  it('JSON inválido → 400', async () => {
    const { app } = makeApp({ withContext: true });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('target_status no soportado por enum → 400 invalid_body', async () => {
    const { app } = makeApp({ withContext: true });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'solicitado' }),
    });
    expect(res.status).toBe(400);
  });

  it('adelanto inexistente → 404', async () => {
    const { app } = makeApp({ withContext: true, selectRows: [] });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'aprobado' }),
    });
    expect(res.status).toBe(404);
  });

  it('transición ilegal (solicitado → desembolsado) → 409 transicion_invalida', async () => {
    const { app } = makeApp({
      withContext: true,
      selectRows: [{ id: 'a1', status: 'solicitado' }],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'desembolsado' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; allowed_targets: string[] };
    expect(body.error).toBe('transicion_invalida');
    expect(body.allowed_targets).toContain('aprobado');
  });

  it('terminal status (cancelado) no permite transiciones → 409', async () => {
    const { app } = makeApp({
      withContext: true,
      selectRows: [{ id: 'a1', status: 'cancelado' }],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'aprobado' }),
    });
    expect(res.status).toBe(409);
  });

  it('transición legal aprobado → desembolsado captura desembolsado_en', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const { app } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'aprobado', empresaShipperId: 'shp-1', montoAdelantadoClp: 100000 },
      ],
      updateRowsSeq: [
        [{ id: 'a1', status: 'desembolsado', desembolsadoEn: now, cobradoAShipperEn: null }],
        [{ id: 'dec-1' }], // decisión vigente actualizada
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'desembolsado', notas: 'transfer ok' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      desembolsado_en: string | null;
      cobrado_a_shipper_en: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('desembolsado');
    expect(body.desembolsado_en).toBe(now.toISOString());
    expect(body.cobrado_a_shipper_en).toBeNull();
  });

  it('transición legal desembolsado → cobrado_a_shipper captura cobrado_a_shipper_en', async () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const { app } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'desembolsado', empresaShipperId: 'shp-1', montoAdelantadoClp: 100000 },
      ],
      updateRowsSeq: [
        [
          {
            id: 'a1',
            status: 'cobrado_a_shipper',
            desembolsadoEn: null,
            cobradoAShipperEn: now,
          },
        ],
        [{ id: 'dec-1' }],
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'cobrado_a_shipper' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cobrado_a_shipper_en: string | null };
    expect(body.cobrado_a_shipper_en).toBe(now.toISOString());
  });

  it('desembolsado → actualiza exposición crediticia de la decisión vigente (2º update)', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const { app, db, updateSetCalls } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'aprobado', empresaShipperId: 'shp-1', montoAdelantadoClp: 250000 },
      ],
      updateRowsSeq: [
        [{ id: 'a1', status: 'desembolsado', desembolsadoEn: now, cobradoAShipperEn: null }],
        [{ id: 'dec-1' }],
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'desembolsado' }),
    });
    expect(res.status).toBe(200);
    // Dos updates: adelanto + shipper_credit_decisions, dentro de la tx.
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(updateSetCalls[1]).toHaveProperty('currentExposureClp');
  });

  it('cobrado_a_shipper → decrementa exposición (2º update con GREATEST piso 0)', async () => {
    const now = new Date('2026-06-10T12:00:00Z');
    const { app, db, updateSetCalls } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'desembolsado', empresaShipperId: 'shp-1', montoAdelantadoClp: 250000 },
      ],
      updateRowsSeq: [
        [{ id: 'a1', status: 'cobrado_a_shipper', desembolsadoEn: null, cobradoAShipperEn: now }],
        [{ id: 'dec-1' }],
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'cobrado_a_shipper' }),
    });
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(2);
    expect(updateSetCalls[1]).toHaveProperty('currentExposureClp');
  });

  it('desembolsado sin decisión vigente → transición OK + warn (exposición no actualizada)', async () => {
    const now = new Date('2026-05-10T12:00:00Z');
    const { app, warnSpy } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'aprobado', empresaShipperId: 'shp-1', montoAdelantadoClp: 250000 },
      ],
      updateRowsSeq: [
        [{ id: 'a1', status: 'desembolsado', desembolsadoEn: now, cobradoAShipperEn: null }],
        [], // sin decisión vigente
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'desembolsado' }),
    });
    expect(res.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ adelantoId: 'a1', targetStatus: 'desembolsado' }),
      expect.stringContaining('exposición NO actualizada'),
    );
  });

  it('transición no-monetaria (solicitado → aprobado) NO toca exposición (1 update)', async () => {
    const { app, db } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'solicitado', empresaShipperId: 'shp-1', montoAdelantadoClp: 250000 },
      ],
      updateRowsSeq: [
        [{ id: 'a1', status: 'aprobado', desembolsadoEn: null, cobradoAShipperEn: null }],
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'aprobado' }),
    });
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);
  });

  it('transición legal mora → cobrado_a_shipper (rescate)', async () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const { app } = makeApp({
      withContext: true,
      selectRows: [
        { id: 'a1', status: 'mora', empresaShipperId: 'shp-1', montoAdelantadoClp: 100000 },
      ],
      updateRows: [
        {
          id: 'a1',
          status: 'cobrado_a_shipper',
          desembolsadoEn: null,
          cobradoAShipperEn: now,
        },
      ],
    });
    const res = await app.request('/admin/cobra-hoy/adelantos/a1/transicionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target_status: 'cobrado_a_shipper' }),
    });
    expect(res.status).toBe(200);
  });
});
