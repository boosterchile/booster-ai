import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const crearMock = vi.fn();
const retirarMock = vi.fn();
const listarMock = vi.fn();
const notifyMock = vi.fn(async () => ({ destinatarios: 2, enviados: 2 }));
vi.mock('../../src/services/solicitud-cambio-carga.js', () => ({
  crearSolicitudCambio: (...a: unknown[]) => crearMock(...a),
  retirarSolicitudCambio: (...a: unknown[]) => retirarMock(...a),
  listarSolicitudesCambio: (...a: unknown[]) => listarMock(...a),
  solicitudPendienteDeViaje: vi.fn(async () => null),
}));
vi.mock('../../src/services/notify-cambio-carga.js', () => ({
  notifyCambioCarga: (...a: unknown[]) => notifyMock(...(a as [])),
}));

const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');

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

function app(role = 'dueno') {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('userContext', {
      user: { id: 'user-1' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm1', role, status: 'activa' },
        empresa: { id: 'emp-1', isGeneradorCarga: true, isTransportista: false, status: 'activa' },
      },
    } as never);
    await next();
  });
  a.route('/trip-requests-v2', createTripRequestsV2Routes({ db: {} as never, logger }));
  return a;
}

const post = (a: Hono, path: string, body?: unknown) =>
  a.request(`/trip-requests-v2/trip-1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const ASG = { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-c' };
const SOLICITUD = {
  id: 'sol-1',
  estado: 'pendiente',
  cambios: { weight_kg: 2000 },
  valores_anteriores: { weight_kg: 1000 },
  creado_en: '2026-11-09T15:00:00.000Z',
  respondido_en: null,
  razon_respuesta: null,
  motivo_invalidacion: null,
  cerrado_en: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /trip-requests-v2/:id/solicitudes-cambio', () => {
  it('201 con la solicitud; avisa a la transportista y al conductor', async () => {
    crearMock.mockResolvedValue({
      ok: true,
      solicitud: SOLICITUD,
      campos: ['weight_kg'],
      asignacion: ASG,
    });
    const res = await post(app(), '/solicitudes-cambio', { cambios: { weight_kg: 2000 } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ solicitud: SOLICITUD });
    expect(crearMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      empresaId: 'emp-1',
      userId: 'user-1',
      cambios: { weight_kg: 2000 },
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: ASG,
      evento: 'cambio_solicitado',
    });
  });

  it('si el aviso falla, la solicitud responde 201 igual', async () => {
    crearMock.mockResolvedValue({
      ok: true,
      solicitud: SOLICITUD,
      campos: ['weight_kg'],
      asignacion: ASG,
    });
    notifyMock.mockRejectedValueOnce(new Error('push caído'));
    expect(
      (await post(app(), '/solicitudes-cambio', { cambios: { weight_kg: 2000 } })).status,
    ).toBe(201);
  });

  it.each([
    [
      { ok: false, code: 'trip_not_found' },
      404,
      { error: 'trip_not_found', code: 'trip_not_found' },
    ],
    [
      { ok: false, code: 'trip_not_matched' },
      409,
      { error: 'trip_not_matched', code: 'trip_not_matched' },
    ],
    [
      { ok: false, code: 'trip_not_editable', currentStatus: 'en_proceso' },
      409,
      { error: 'trip_not_editable', code: 'trip_not_editable', current_status: 'en_proceso' },
    ],
    [
      { ok: false, code: 'cambio_pendiente_existente', solicitudId: 'sol-0' },
      409,
      {
        error: 'cambio_pendiente_existente',
        code: 'cambio_pendiente_existente',
        solicitud_id: 'sol-0',
      },
    ],
    [{ ok: false, code: 'sin_cambios' }, 422, { error: 'sin_cambios', code: 'sin_cambios' }],
  ])('resultado %j → %i', async (resultado, status, body) => {
    crearMock.mockResolvedValue(resultado);
    const res = await post(app(), '/solicitudes-cambio', { cambios: { weight_kg: 2000 } });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('visualizador → 403 read_only; un campo comercial o un dato libre → 400', async () => {
    expect(
      (await post(app('visualizador'), '/solicitudes-cambio', { cambios: { weight_kg: 2 } }))
        .status,
    ).toBe(403);
    expect(
      (await post(app(), '/solicitudes-cambio', { cambios: { proposed_price_clp: 1 } })).status,
    ).toBe(400);
    expect((await post(app(), '/solicitudes-cambio', { cambios: { notes: 'x' } })).status).toBe(
      400,
    );
    expect((await post(app(), '/solicitudes-cambio', { cambios: {} })).status).toBe(400);
    expect(crearMock).not.toHaveBeenCalled();
  });
});

describe('POST /trip-requests-v2/:id/solicitudes-cambio/:sid/retirar', () => {
  it('200 y avisa que se retiró', async () => {
    retirarMock.mockResolvedValue({ ok: true, asignacion: ASG });
    const res = await post(app(), '/solicitudes-cambio/sol-1/retirar');
    expect(res.status).toBe(200);
    expect(retirarMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      empresaId: 'emp-1',
      userId: 'user-1',
      solicitudId: 'sol-1',
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: ASG,
      evento: 'cambio_retirado',
    });
  });

  it('ya no vigente → 409; viaje ajeno → 404', async () => {
    retirarMock.mockResolvedValueOnce({ ok: false, code: 'solicitud_no_vigente' });
    expect((await post(app(), '/solicitudes-cambio/sol-1/retirar')).status).toBe(409);
    retirarMock.mockResolvedValueOnce({ ok: false, code: 'trip_not_found' });
    expect((await post(app(), '/solicitudes-cambio/sol-1/retirar')).status).toBe(404);
    expect(notifyMock).not.toHaveBeenCalled();
  });
});

describe('GET /trip-requests-v2/:id/solicitudes-cambio', () => {
  it('lista el historial; viaje ajeno → 404', async () => {
    listarMock.mockResolvedValueOnce([SOLICITUD]);
    const ok = await app().request('/trip-requests-v2/trip-1/solicitudes-cambio');
    expect(await ok.json()).toEqual({ solicitudes: [SOLICITUD] });
    listarMock.mockResolvedValueOnce(null);
    expect((await app().request('/trip-requests-v2/trip-1/solicitudes-cambio')).status).toBe(404);
  });
});
