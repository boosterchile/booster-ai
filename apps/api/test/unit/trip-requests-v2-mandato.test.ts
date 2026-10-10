import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';

/**
 * ADR-080 en las rutas del generador: la confirmación de recepción registra
 * la recepción conforme con MANDATO_COBRO_ACTIVATED; GET /:id/pago y
 * POST /:id/disputa responden 404 con el flag apagado.
 */
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const confirmarEntregaViaje = vi.fn();
vi.mock('../../src/services/confirmar-entrega-viaje.js', () => ({
  confirmarEntregaViaje: (...a: unknown[]) => confirmarEntregaViaje(...a),
}));
const liquidarTrip = vi.fn(async () => ({ status: 'ya_liquidada', liquidacionId: 'l-1' }));
vi.mock('../../src/services/liquidar-trip.js', () => ({
  liquidarTrip: (...a: unknown[]) => liquidarTrip(...(a as [])),
}));
const registrarRecepcionConforme = vi.fn();
const leerPagoDelGenerador = vi.fn();
const abrirDisputa = vi.fn();
vi.mock('../../src/services/mandato-cobro/eventos-pago.js', () => ({
  registrarRecepcionConforme: (...a: unknown[]) => registrarRecepcionConforme(...a),
  leerPagoDelGenerador: (...a: unknown[]) => leerPagoDelGenerador(...a),
  abrirDisputa: (...a: unknown[]) => abrirDisputa(...a),
}));
vi.mock('../../src/services/matching.js', () => ({
  runMatching: vi.fn(),
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
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

const PAGO = {
  asignacion_id: 'asg-1',
  modo_flujo: 'mandato_cobro',
  recepcion_conforme_en: '2026-10-10T12:00:00.000Z',
  cobro: { estado: 'pendiente', en: null, monto_clp: null, vence_en: '2026-11-09T12:00:00.000Z' },
  liberacion: {
    estado: 'pendiente',
    en: null,
    monto_clp: null,
    vence_en: '2026-10-15T12:00:00.000Z',
  },
  montos_esperados: { cobro_clp: 1_238_000, liberacion_clp: 1_000_000 },
  eventos: [{ tipo: 'recepcion_conforme', evidencia_ref: 'doc-1' }],
};

function setup() {
  const app = new Hono();
  app.use('/trip-requests-v2/*', async (c, next) => {
    c.set(
      'userContext' as never,
      {
        user: { id: 'user-1', email: 'g@x.cl' },
        memberships: [],
        activeMembership: {
          membership: { role: 'dueno' },
          empresa: { id: 'emp-gen', isGeneradorCarga: true, status: 'activa' },
        },
      } as never,
    );
    await next();
  });
  app.route('/trip-requests-v2', createTripRequestsV2Routes({ db: {} as Db, logger }));
  return app;
}

const confirmar = (app: Hono) =>
  app.request('/trip-requests-v2/trip-1/confirmar-recepcion', { method: 'PATCH' });

afterEach(() => {
  appConfig.MANDATO_COBRO_ACTIVATED = false;
  vi.clearAllMocks();
});

describe('PATCH /trip-requests-v2/:id/confirmar-recepcion — mandato de cobro', () => {
  it('flag apagado: no toca el mandato y la respuesta no trae pago', async () => {
    confirmarEntregaViaje.mockResolvedValue({
      ok: true,
      alreadyDelivered: false,
      deliveredAt: new Date('2026-10-10T12:00:00Z'),
    });
    const res = await confirmar(setup());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.pago).toBeUndefined();
    expect(registrarRecepcionConforme).not.toHaveBeenCalled();
  });

  it('flag encendido: registra la recepción conforme y devuelve el pago sin eventos', async () => {
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    confirmarEntregaViaje.mockResolvedValue({
      ok: true,
      alreadyDelivered: true,
      deliveredAt: new Date('2026-10-10T12:00:00Z'),
    });
    registrarRecepcionConforme.mockImplementation(
      async (_deps: unknown, input: { asegurarLiquidacion: (id: string) => Promise<unknown> }) => {
        await input.asegurarLiquidacion('asg-1');
        return { ok: true, pago: PAGO };
      },
    );
    const res = await confirmar(setup());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pago: Record<string, unknown> };
    expect(body.pago.cobro).toEqual(PAGO.cobro);
    expect(body.pago.eventos).toBeUndefined();
    expect(registrarRecepcionConforme.mock.calls[0]?.[1]).toMatchObject({
      tripId: 'trip-1',
      generadorEmpresaId: 'emp-gen',
      registradoPor: 'user-1',
    });
    // asegurarLiquidacion liquida con el flag de mandato.
    expect(liquidarTrip.mock.calls[0]?.[0]).toMatchObject({
      assignmentId: 'asg-1',
      mandatoCobroActivated: true,
    });
  });

  it('flag encendido sin recepción posible: la entrega igual queda confirmada y se informa por qué', async () => {
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    confirmarEntregaViaje.mockResolvedValue({
      ok: true,
      alreadyDelivered: false,
      deliveredAt: new Date('2026-10-10T12:00:00Z'),
    });
    registrarRecepcionConforme.mockResolvedValue({ ok: false, code: 'sin_documento' });
    const res = await confirmar(setup());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      recepcion_conforme_pendiente: 'sin_documento',
    });
  });

  it('liquidación conector con flag encendido: sin pago ni pendiente', async () => {
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    confirmarEntregaViaje.mockResolvedValue({
      ok: true,
      alreadyDelivered: false,
      deliveredAt: new Date('2026-10-10T12:00:00Z'),
    });
    registrarRecepcionConforme.mockResolvedValue({ ok: false, code: 'no_es_mandato' });
    const body = (await (await confirmar(setup())).json()) as Record<string, unknown>;
    expect(body.pago).toBeUndefined();
    expect(body.recepcion_conforme_pendiente).toBeUndefined();
  });
});

describe('GET /trip-requests-v2/:id/pago', () => {
  it('flag apagado → 404 mandato_cobro_desactivado', async () => {
    const res = await setup().request('/trip-requests-v2/trip-1/pago');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'mandato_cobro_desactivado' });
  });

  it('sin pago → 404; con pago → estado sin eventos', async () => {
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    leerPagoDelGenerador.mockResolvedValueOnce(null);
    const app = setup();
    expect((await app.request('/trip-requests-v2/trip-1/pago')).status).toBe(404);
    leerPagoDelGenerador.mockResolvedValueOnce(PAGO);
    const res = await app.request('/trip-requests-v2/trip-1/pago');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pago: Record<string, unknown> };
    expect(body.pago.liberacion).toEqual(PAGO.liberacion);
    expect(body.pago.eventos).toBeUndefined();
    expect(leerPagoDelGenerador).toHaveBeenLastCalledWith(expect.anything(), 'trip-1', 'emp-gen');
  });
});

describe('POST /trip-requests-v2/:id/disputa', () => {
  const disputa = (app: Hono, motivo: unknown) =>
    app.request('/trip-requests-v2/trip-1/disputa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ motivo }),
    });

  it('flag apagado → 404', async () => {
    expect((await disputa(setup(), 'La carga llegó dañada')).status).toBe(404);
  });

  it('motivo corto → 400; viaje ajeno → 404; transición inválida → 409; ok → 201', async () => {
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    const app = setup();
    expect((await disputa(app, 'corto')).status).toBe(400);
    abrirDisputa.mockResolvedValueOnce({ ok: false, code: 'viaje_no_encontrado' });
    expect((await disputa(app, 'La carga llegó dañada')).status).toBe(404);
    abrirDisputa.mockResolvedValueOnce({ ok: false, code: 'liberacion_no_pendiente' });
    const r409 = await disputa(app, 'La carga llegó dañada');
    expect(r409.status).toBe(409);
    expect(await r409.json()).toEqual({ error: 'liberacion_no_pendiente' });
    abrirDisputa.mockResolvedValueOnce({ ok: true, pago: PAGO });
    const ok = await disputa(app, 'La carga llegó dañada');
    expect(ok.status).toBe(201);
    expect(abrirDisputa.mock.calls.at(-1)?.[1]).toEqual({
      tripId: 'trip-1',
      generadorEmpresaId: 'emp-gen',
      userId: 'user-1',
      motivo: 'La carga llegó dañada',
    });
  });
});
