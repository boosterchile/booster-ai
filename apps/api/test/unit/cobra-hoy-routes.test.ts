import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import {
  createCobraHoyAssignmentsRoutes,
  createCobraHoyMeRoutes,
} from '../../src/routes/cobra-hoy.js';
import type { UserContext } from '../../src/services/user-context.js';

/**
 * Tests HTTP de las rutas de Cobra Hoy. La lógica de negocio ya está
 * cubierta por `cobra-hoy.test.ts` (15 tests del service). Acá validamos
 * solamente:
 *
 *   - Flag-gating (503 cuando FACTORING_V1_ACTIVATED=false).
 *   - userContext faltante (400 no_active_empresa).
 *   - Mapping correcto de service result → status HTTP + body.
 *   - Parsing de query params (plazo_dias).
 *
 * Mockeamos el service para no acoplar a la BD.
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

const cotizarSpy = vi.fn();
const cobraHoySpy = vi.fn();
vi.mock('../../src/services/cobra-hoy.js', () => ({
  cotizarCobraHoy: (...args: unknown[]) => cotizarSpy(...args),
  cobraHoy: (...args: unknown[]) => cobraHoySpy(...args),
}));

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';
const USER_CTX: UserContext = {
  user: { id: 'u1', firebaseUid: 'fb1', fullName: 'F', email: 'f@x.cl' },
  activeMembership: {
    id: 'm1',
    role: 'dueno',
    status: 'activa',
    empresa: {
      id: EMPRESA_ID,
      legalName: 'E',
      rut: '76',
      isGeneradorCarga: false,
      isTransportista: true,
      status: 'activa',
    },
  },
  memberships: [],
} as unknown as UserContext;

function makeAssignmentsApp(opts: { withContext: boolean; db?: unknown }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.withContext) {
      c.set('userContext', USER_CTX);
    }
    await next();
  });
  app.route(
    '/assignments',
    createCobraHoyAssignmentsRoutes({
      db: (opts.db ?? {}) as never,
      logger: noopLogger,
    }),
  );
  return app;
}

function makeMeApp(opts: { withContext: boolean; db: unknown }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.withContext) {
      c.set('userContext', USER_CTX);
    }
    await next();
  });
  app.route(
    '/me',
    createCobraHoyMeRoutes({
      db: opts.db as never,
      logger: noopLogger,
    }),
  );
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.FACTORING_V1_ACTIVATED = true;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /assignments/:id/cobra-hoy/cotizacion — flag + ctx', () => {
  it('flag off → 503 feature_disabled', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'feature_disabled' });
  });

  it('sin userContext → 400 no_active_empresa', async () => {
    const app = makeAssignmentsApp({ withContext: false });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no_active_empresa' });
  });

  it('plazo_dias inválido (0) → 400 invalid_plazo', async () => {
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion?plazo_dias=0');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_plazo' });
  });

  it('plazo_dias inválido (negativo) → 400 invalid_plazo', async () => {
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion?plazo_dias=-5');
    expect(res.status).toBe(400);
  });
});

describe('GET /assignments/:id/cobra-hoy/cotizacion — service mapping', () => {
  it('assignment_not_found → 404', async () => {
    cotizarSpy.mockResolvedValue({ status: 'assignment_not_found' });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion');
    expect(res.status).toBe(404);
  });

  it('forbidden_owner_mismatch → 403', async () => {
    cotizarSpy.mockResolvedValue({ status: 'forbidden_owner_mismatch' });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion');
    expect(res.status).toBe(403);
  });

  it('no_liquidacion → 409', async () => {
    cotizarSpy.mockResolvedValue({ status: 'no_liquidacion' });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion');
    expect(res.status).toBe(409);
  });

  it('ok → 200 con desglose serializado snake_case', async () => {
    cotizarSpy.mockResolvedValue({
      status: 'ok',
      montoNetoClp: 176000,
      plazoDiasShipper: 30,
      tarifaPct: 1.5,
      tarifaClp: 2640,
      montoAdelantadoClp: 173360,
    });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy/cotizacion?plazo_dias=30');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      monto_neto_clp: 176000,
      plazo_dias_shipper: 30,
      tarifa_pct: 1.5,
      tarifa_clp: 2640,
      monto_adelantado_clp: 173360,
    });
    // Service recibió el empresaCarrierId del userContext.
    expect(cotizarSpy).toHaveBeenCalledWith(
      expect.objectContaining({ empresaCarrierId: EMPRESA_ID, plazoDiasShipper: 30 }),
    );
  });
});

describe('POST /assignments/:id/cobra-hoy — service mapping completo', () => {
  it('flag off → 503', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('assignment_not_delivered → 409', async () => {
    cobraHoySpy.mockResolvedValue({ status: 'assignment_not_delivered' });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('assignment_not_delivered');
  });

  it('shipper_no_aprobado → 422 + motivo', async () => {
    cobraHoySpy.mockResolvedValue({
      status: 'shipper_no_aprobado',
      motivo: 'Score insuficiente',
    });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('shipper_no_aprobado');
    expect(body.message).toBe('Score insuficiente');
  });

  it('limite_exposicion_excedido → 422 + limit/exposicion', async () => {
    cobraHoySpy.mockResolvedValue({
      status: 'limite_exposicion_excedido',
      limitClp: 50_000_000,
      exposicionClp: 51_000_000,
    });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: 'limite_exposicion_excedido',
      limit_clp: 50_000_000,
      exposicion_clp: 51_000_000,
    });
  });

  it('ya_solicitado → 200 already_requested=true', async () => {
    cobraHoySpy.mockResolvedValue({ status: 'ya_solicitado', adelantoId: 'adel-1' });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      already_requested: true,
      adelanto_id: 'adel-1',
    });
  });

  it('solicitado → 201 con tarifa serializada', async () => {
    cobraHoySpy.mockResolvedValue({
      status: 'solicitado',
      adelantoId: 'adel-1',
      tarifaPct: 1.5,
      tarifaClp: 2640,
      montoAdelantadoClp: 173360,
    });
    const app = makeAssignmentsApp({ withContext: true });
    const res = await app.request('/assignments/asg-1/cobra-hoy', { method: 'POST' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      already_requested: false,
      adelanto_id: 'adel-1',
      tarifa_pct: 1.5,
      tarifa_clp: 2640,
      monto_adelantado_clp: 173360,
    });
  });
});

describe('GET /me/cobra-hoy/historial', () => {
  function makeDbWithAdelantos(rows: Array<Record<string, unknown>>) {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => rows),
    };
    return { select: vi.fn(() => chain) };
  }

  it('flag off → 503', async () => {
    appConfig.FACTORING_V1_ACTIVATED = false;
    const app = makeMeApp({ withContext: true, db: makeDbWithAdelantos([]) });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(503);
  });

  it('sin userContext → 400', async () => {
    const app = makeMeApp({ withContext: false, db: makeDbWithAdelantos([]) });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(400);
  });

  it('lista vacía → 200 con adelantos:[]', async () => {
    const app = makeMeApp({ withContext: true, db: makeDbWithAdelantos([]) });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adelantos: [] });
  });

  it('lista con un adelanto → serializa fechas + decimales', async () => {
    const desembolsadoAt = new Date('2026-05-09T12:00:00Z');
    const createdAt = new Date('2026-05-08T11:00:00Z');
    const db = makeDbWithAdelantos([
      {
        id: 'a1',
        asignacionId: 'asg-1',
        montoNetoClp: 176000,
        plazoDiasShipper: 30,
        tarifaPct: '1.50',
        tarifaClp: 2640,
        montoAdelantadoClp: 173360,
        status: 'desembolsado',
        desembolsadoEn: desembolsadoAt,
        rechazoMotivo: null,
        notasAdmin: null,
        createdAt,
      },
    ]);
    const app = makeMeApp({ withContext: true, db });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adelantos: Array<Record<string, unknown>> };
    expect(body.adelantos).toHaveLength(1);
    expect(body.adelantos[0]).toMatchObject({
      id: 'a1',
      asignacion_id: 'asg-1',
      monto_neto_clp: 176000,
      tarifa_pct: 1.5,
      tarifa_clp: 2640,
      monto_adelantado_clp: 173360,
      status: 'desembolsado',
      desembolsado_en: desembolsadoAt.toISOString(),
      creado_en: createdAt.toISOString(),
      // `desembolsado` no expone notas al carrier (privacidad operativa).
      nota_visible: null,
    });
  });

  it('adelanto rechazado con motivo → nota_visible = rechazoMotivo', async () => {
    const db = makeDbWithAdelantos([
      {
        id: 'a1',
        asignacionId: 'asg-1',
        montoNetoClp: 176000,
        plazoDiasShipper: 30,
        tarifaPct: '1.50',
        tarifaClp: 2640,
        montoAdelantadoClp: 173360,
        status: 'rechazado',
        desembolsadoEn: null,
        rechazoMotivo: 'Score insuficiente del shipper',
        notasAdmin: null,
        createdAt: new Date('2026-05-08T11:00:00Z'),
      },
    ]);
    const app = makeMeApp({ withContext: true, db });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adelantos: Array<Record<string, unknown>> };
    expect(body.adelantos[0]?.nota_visible).toBe('Score insuficiente del shipper');
  });

  it('adelanto mora con notas_admin → nota_visible = última línea sin tag', async () => {
    const db = makeDbWithAdelantos([
      {
        id: 'a1',
        asignacionId: 'asg-1',
        montoNetoClp: 176000,
        plazoDiasShipper: 30,
        tarifaPct: '1.50',
        tarifaClp: 2640,
        montoAdelantadoClp: 173360,
        status: 'mora',
        desembolsadoEn: new Date('2026-04-01T12:00:00Z'),
        rechazoMotivo: null,
        notasAdmin:
          '[2026-05-01T09:00:00.000Z admin@boosterchile.com] approval ok\n[2026-05-10T09:00:00.000Z cron@boosterchile.com] auto-mora: shipper no pagó en plazo (10 días vencidos sobre 30).',
        createdAt: new Date('2026-04-01T11:00:00Z'),
      },
    ]);
    const app = makeMeApp({ withContext: true, db });
    const res = await app.request('/me/cobra-hoy/historial');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { adelantos: Array<Record<string, unknown>> };
    expect(body.adelantos[0]?.nota_visible).toBe(
      'auto-mora: shipper no pagó en plazo (10 días vencidos sobre 30).',
    );
  });
});

describe('buildNotaVisible (helper puro)', () => {
  it('estado solicitado → null aunque tenga notas', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('solicitado', null, '[2026-05-01 admin@x] nota interna')).toBeNull();
  });

  it('estado aprobado → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('aprobado', null, '[2026 admin@x] nota')).toBeNull();
  });

  it('estado desembolsado → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('desembolsado', null, '[t admin@x] x')).toBeNull();
  });

  it('estado cobrado_a_shipper → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('cobrado_a_shipper', null, '[t a@x] y')).toBeNull();
  });

  it('rechazado con rechazoMotivo → usa el motivo', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('rechazado', 'Sin antigüedad', null)).toBe('Sin antigüedad');
  });

  it('rechazado sin rechazoMotivo + notas_admin → última línea limpia', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(
      buildNotaVisible(
        'rechazado',
        null,
        '[2026-05-01T09:00:00.000Z admin@boosterchile.com] revisión inicial\n[2026-05-02T09:00:00.000Z admin@boosterchile.com] rechazado: límite excedido',
      ),
    ).toBe('rechazado: límite excedido');
  });

  it('cancelado sin motivo y sin notas → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('cancelado', null, null)).toBeNull();
  });

  it('mora sin notas → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('mora', null, null)).toBeNull();
  });

  it('mora con notas con varias líneas → última línea sin tag', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(
      buildNotaVisible(
        'mora',
        null,
        '[2026-05-01T09:00:00.000Z cron@boosterchile.com] auto-mora: shipper no pagó en plazo (5 días vencidos sobre 30).',
      ),
    ).toBe('auto-mora: shipper no pagó en plazo (5 días vencidos sobre 30).');
  });

  it('línea con tag pero sin contenido → null', async () => {
    const { buildNotaVisible } = await import('../../src/routes/cobra-hoy.js');
    expect(buildNotaVisible('rechazado', null, '[2026-05-01T09:00:00.000Z admin@x]')).toBeNull();
  });
});
