import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const editarMock = vi.fn();
const notifyMock = vi.fn(async () => ({ destinatarios: 2, enviados: 2 }));
const reenviarMock = vi.fn(async () => ({ assignmentId: 'asg-1', skipped: false }));
vi.mock('../../src/services/editar-datos-libres.js', () => ({
  editarDatosLibres: (...a: unknown[]) => editarMock(...a),
}));
vi.mock('../../src/services/notify-cambio-carga.js', () => ({
  notifyCambioCarga: (...a: unknown[]) => notifyMock(...(a as [])),
}));
vi.mock('../../src/services/notify-tracking-link.js', () => ({
  reenviarTrackingLinkADestinatario: (...a: unknown[]) => reenviarMock(...(a as [])),
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

const NOTIFY_TRACKING = { twilioClient: null, contentSidTracking: null };

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
  a.route(
    '/trip-requests-v2',
    createTripRequestsV2Routes({
      db: {} as never,
      logger,
      notifyTrackingLink: NOTIFY_TRACKING as never,
    }),
  );
  return a;
}

const patch = (a: Hono, body: unknown) =>
  a.request('/trip-requests-v2/trip-1/datos-libres', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const OK_CON_ASIGNACION = {
  ok: true,
  campos: ['consignee'],
  telefonoDestinatarioNuevo: '+56922222222',
  asignacion: { id: 'asg-1', status: 'asignado', empresaId: 'emp-t', driverUserId: 'u-c' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /trip-requests-v2/:id/datos-libres', () => {
  it('200 con los campos editados; avisa y reenvía el link al número nuevo', async () => {
    editarMock.mockResolvedValue(OK_CON_ASIGNACION);
    const res = await patch(app(), { consignee: { phone_e164: '+56922222222' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trip_request: { id: 'trip-1', campos: ['consignee'] } });
    expect(editarMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      empresaId: 'emp-1',
      userId: 'user-1',
      input: { consignee: { phone_e164: '+56922222222' } },
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: OK_CON_ASIGNACION.asignacion,
      evento: 'datos_libres',
    });
    expect(reenviarMock).toHaveBeenCalledWith(expect.objectContaining(NOTIFY_TRACKING), {
      assignmentId: 'asg-1',
      telefono: '+56922222222',
    });
  });

  it('sin asignación no avisa ni reenvía', async () => {
    editarMock.mockResolvedValue({
      ok: true,
      campos: ['notes'],
      telefonoDestinatarioNuevo: null,
      asignacion: null,
    });
    expect((await patch(app(), { notes: 'Andén 4' })).status).toBe(200);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(reenviarMock).not.toHaveBeenCalled();
  });

  it('si el aviso falla, la edición responde 200 igual', async () => {
    editarMock.mockResolvedValue(OK_CON_ASIGNACION);
    notifyMock.mockRejectedValueOnce(new Error('db caída'));
    reenviarMock.mockRejectedValueOnce(new Error('twilio 503'));
    expect((await patch(app(), { consignee: { phone_e164: '+56922222222' } })).status).toBe(200);
  });

  it.each([
    [
      { ok: false, code: 'trip_not_found' },
      404,
      { error: 'trip_not_found', code: 'trip_not_found' },
    ],
    [
      { ok: false, code: 'trip_not_editable', currentStatus: 'entregado' },
      409,
      { error: 'trip_not_editable', code: 'trip_not_editable', current_status: 'entregado' },
    ],
    [{ ok: false, code: 'sin_cambios' }, 422, { error: 'sin_cambios', code: 'sin_cambios' }],
  ])('resultado %j → %i', async (resultado, status, body) => {
    editarMock.mockResolvedValue(resultado);
    const res = await patch(app(), { notes: 'x' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
  });

  it('visualizador → 403 read_only, sin llamar al servicio', async () => {
    const res = await patch(app('visualizador'), { notes: 'x' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('read_only');
    expect(editarMock).not.toHaveBeenCalled();
  });

  it('body vacío o con un campo material → 400', async () => {
    expect((await patch(app(), {})).status).toBe(400);
    expect((await patch(app(), { notes: 'x', weight_kg: 1 })).status).toBe(400);
    expect(editarMock).not.toHaveBeenCalled();
  });
});
