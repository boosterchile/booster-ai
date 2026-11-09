import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const cancelarMock = vi.fn();
const notifyMock = vi.fn(async () => ({ destinatarios: 2, enviados: 2 }));
vi.mock('../../src/services/cancelar-carga.js', () => ({
  cancelarCarga: (...a: unknown[]) => cancelarMock(...a),
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

function app(role: string | null = 'dueno') {
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (role) {
      c.set('userContext', {
        user: { id: 'user-1' },
        memberships: [],
        activeMembership: {
          membership: { id: 'm1', role, status: 'activa' },
          empresa: {
            id: 'emp-1',
            isGeneradorCarga: true,
            isTransportista: false,
            status: 'activa',
          },
        },
      } as never);
    }
    await next();
  });
  a.route('/trip-requests-v2', createTripRequestsV2Routes({ db: {} as never, logger }));
  return a;
}

const cancelar = (a: Hono, body: unknown) =>
  a.request('/trip-requests-v2/trip-1/cancelar', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const ASG = { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-c' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /trip-requests-v2/:id/cancelar', () => {
  it('sin sesión → 401', async () => {
    expect((await cancelar(app(null), {})).status).toBe(401);
    expect(cancelarMock).not.toHaveBeenCalled();
  });

  it('visualizador → 403 read_only, sin llamar al servicio', async () => {
    const res = await cancelar(app('visualizador'), { reason: 'x' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('read_only');
    expect(cancelarMock).not.toHaveBeenCalled();
  });

  it('anula antes del match: 200 con tipo anulacion, sin aviso', async () => {
    cancelarMock.mockResolvedValue({
      ok: true,
      tipo: 'anulacion',
      ofertasInvalidadas: 2,
      asignacion: null,
    });
    const res = await cancelar(app(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trip_request: { id: 'trip-1', status: 'cancelado', tipo: 'anulacion' },
    });
    expect(cancelarMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      empresaId: 'emp-1',
      userId: 'user-1',
    });
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('cancela después del match: pasa el motivo y avisa a la transportista con él', async () => {
    cancelarMock.mockResolvedValue({
      ok: true,
      tipo: 'cancelacion',
      ofertasInvalidadas: 0,
      asignacion: ASG,
      motivo: 'El cliente postergó el pedido',
    });
    const res = await cancelar(app(), { reason: 'El cliente postergó el pedido' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trip_request: { id: 'trip-1', status: 'cancelado', tipo: 'cancelacion' },
    });
    expect(cancelarMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'El cliente postergó el pedido' }),
    );
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: ASG,
      evento: 'cancelacion',
      motivo: 'El cliente postergó el pedido',
    });
  });

  it('si el aviso falla, la cancelación responde 200 igual', async () => {
    cancelarMock.mockResolvedValue({
      ok: true,
      tipo: 'cancelacion',
      ofertasInvalidadas: 0,
      asignacion: ASG,
      motivo: 'm',
    });
    notifyMock.mockRejectedValueOnce(new Error('push caído'));
    expect((await cancelar(app(), { reason: 'm' })).status).toBe(200);
  });

  it.each([
    [
      { ok: false, code: 'trip_not_found' },
      404,
      { error: 'trip_not_found', code: 'trip_not_found' },
    ],
    [
      { ok: false, code: 'trip_not_cancellable', currentStatus: 'en_proceso' },
      409,
      { error: 'trip_not_cancellable', code: 'trip_not_cancellable', current_status: 'en_proceso' },
    ],
    [
      { ok: false, code: 'reason_required' },
      422,
      { error: 'reason_required', code: 'reason_required' },
    ],
  ])('resultado %j → %i', async (resultado, status, body) => {
    cancelarMock.mockResolvedValue(resultado);
    const res = await cancelar(app(), {});
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('motivo de más de 500 caracteres → 400', async () => {
    expect((await cancelar(app(), { reason: 'x'.repeat(501) })).status).toBe(400);
    expect(cancelarMock).not.toHaveBeenCalled();
  });
});
