import { Hono } from 'hono';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * ADR-080 — conciliación del platform-admin: resumen con float y tope,
 * registro de cobros, liberaciones, anticipos y resolución de disputas con
 * evidencia obligatoria. 404 con MANDATO_COBRO_ACTIVATED apagado.
 */
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const listarPagosMandato = vi.fn();
const calcularFloatActual = vi.fn();
const registrarEventoPago = vi.fn();
vi.mock('../../src/services/mandato-cobro/eventos-pago.js', () => ({
  listarPagosMandato: (...a: unknown[]) => listarPagosMandato(...a),
  calcularFloatActual: (...a: unknown[]) => calcularFloatActual(...a),
  registrarEventoPago: (...a: unknown[]) => registrarEventoPago(...a),
}));

const { config: appConfig } = await import('../../src/config.js');
const { createAdminMandatoCobroRoutes } = await import('../../src/routes/admin-mandato-cobro.js');

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

const ADMIN = 'admin@boosterchile.com';
const ASG = '11111111-1111-4111-8111-111111111111';

function app(email: string | null) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (email) {
      c.set('userContext' as never, { user: { id: 'u', email } } as never);
    }
    await next();
  });
  a.route('/admin/mandato-cobro', createAdminMandatoCobroRoutes({ db: {} as never, logger }));
  return a;
}

const fila = (cobro: string, liberacion: string) => ({
  asignacion_id: ASG,
  tracking_code: 'ABC',
  cobro: { estado: cobro, vence_en: null },
  liberacion: { estado: liberacion, vence_en: null },
});

const post = (a: Hono, body: unknown, asg = ASG) =>
  a.request(`/admin/mandato-cobro/${asg}/eventos`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const COBRO = {
  tipo: 'cobro_registrado',
  monto_clp: 1_238_000,
  evidencia_ref: 'abono-77',
  ocurrido_en: '2026-11-09T15:00:00-03:00',
};

afterEach(() => {
  appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [];
  appConfig.MANDATO_COBRO_ACTIVATED = false;
  appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP = 0;
  vi.clearAllMocks();
});

describe('/admin/mandato-cobro', () => {
  it('sin sesión 401; no admin 403', async () => {
    expect((await app(null).request('/admin/mandato-cobro')).status).toBe(401);
    expect((await app('otro@x.cl').request('/admin/mandato-cobro')).status).toBe(403);
  });

  it('admin con el flag apagado → 404 mandato_cobro_desactivado', async () => {
    appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
    const res = await app(ADMIN).request('/admin/mandato-cobro');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'mandato_cobro_desactivado' });
    expect((await post(app(ADMIN), COBRO)).status).toBe(404);
  });

  it('GET: resumen con float, tope y conteos por estado', async () => {
    appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP = 5_000_000;
    listarPagosMandato.mockResolvedValue([
      fila('pendiente', 'liberado_por_booster'),
      fila('mora', 'pendiente'),
      fila('cobrado', 'anticipado_por_operador'),
    ]);
    calcularFloatActual.mockResolvedValue(1_000_000);
    const res = await app(ADMIN).request('/admin/mandato-cobro');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      float_clp: 1_000_000,
      tope_float_clp: 5_000_000,
      conteos: {
        cobro: { pendiente: 1, mora: 1, cobrado: 1 },
        liberacion: { liberado_por_booster: 1, pendiente: 1, anticipado_por_operador: 1 },
      },
    });
    expect(body.viajes).toHaveLength(3);
  });

  it('POST: valida el body y la asignación', async () => {
    appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    expect((await post(app(ADMIN), { ...COBRO, evidencia_ref: '' })).status).toBe(400);
    expect((await post(app(ADMIN), COBRO, 'no-uuid')).status).toBe(400);
    expect(registrarEventoPago).not.toHaveBeenCalled();
  });

  it('POST: registra con el email del admin y el tope configurado', async () => {
    appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP = 7_000_000;
    registrarEventoPago.mockResolvedValue({ ok: true, pago: { asignacion_id: ASG } });
    const res = await post(app(ADMIN), { ...COBRO, detalle: 'conciliado' });
    expect(res.status).toBe(201);
    const [deps, input] = registrarEventoPago.mock.calls[0] ?? [];
    expect(deps).toMatchObject({ topeFloatClp: 7_000_000 });
    expect(input).toEqual({
      asignacionId: ASG,
      tipo: 'cobro_registrado',
      montoClp: 1_238_000,
      evidenciaRef: 'abono-77',
      detalle: 'conciliado',
      ocurridoEn: new Date('2026-11-09T18:00:00Z'),
      registradoPor: ADMIN,
    });
  });

  it('POST: errores explícitos (404, 422 tope con disponible, 409 transición)', async () => {
    appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS = [ADMIN];
    appConfig.MANDATO_COBRO_ACTIVATED = true;
    registrarEventoPago.mockResolvedValueOnce({ ok: false, code: 'liquidacion_no_encontrada' });
    expect((await post(app(ADMIN), COBRO)).status).toBe(404);
    registrarEventoPago.mockResolvedValueOnce({
      ok: false,
      code: 'tope_float_excedido',
      disponibleClp: 250_000,
    });
    const tope = await post(app(ADMIN), {
      tipo: 'liberacion_booster',
      monto_clp: 1_000_000,
      evidencia_ref: 'trf-1',
      ocurrido_en: '2026-10-15T12:00:00Z',
    });
    expect(tope.status).toBe(422);
    expect(await tope.json()).toEqual({ error: 'tope_float_excedido', disponible_clp: 250_000 });
    registrarEventoPago.mockResolvedValueOnce({ ok: false, code: 'cobro_no_pendiente' });
    const c409 = await post(app(ADMIN), COBRO);
    expect(c409.status).toBe(409);
    expect(await c409.json()).toEqual({ error: 'cobro_no_pendiente' });
  });
});
