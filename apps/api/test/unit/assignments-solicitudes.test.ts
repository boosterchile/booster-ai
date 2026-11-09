import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const aceptarMock = vi.fn();
const rechazarMock = vi.fn();
const notifyMock = vi.fn(async () => ({ destinatarios: 2, enviados: 2 }));
const metricasMock = vi.fn(async () => ({}));
vi.mock('../../src/services/solicitud-cambio-carga.js', () => ({
  aceptarSolicitudCambio: (...a: unknown[]) => aceptarMock(...a),
  rechazarSolicitudCambio: (...a: unknown[]) => rechazarMock(...a),
  solicitudPendienteDeViaje: vi.fn(async () => null),
}));
vi.mock('../../src/services/notify-cambio-carga.js', () => ({
  notifyCambioCarga: (...a: unknown[]) => notifyMock(...(a as [])),
}));
vi.mock('../../src/services/calcular-metricas-viaje.js', () => ({
  calcularMetricasEstimadas: (...a: unknown[]) => metricasMock(...(a as [])),
}));

const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');

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

function app(role = 'dueno', puedeAceptarOfertas = false) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    c.set('userContext', {
      user: { id: 'user-1' },
      memberships: [],
      activeMembership: {
        membership: { id: 'm1', role, status: 'activa', puedeAceptarOfertas },
        empresa: { id: 'emp-t', isGeneradorCarga: false, isTransportista: true, status: 'activa' },
      },
    } as never);
    await next();
  });
  a.route(
    '/assignments',
    createAssignmentsRoutes({ db: {} as never, logger, routesProjectId: 'proj' }),
  );
  return a;
}

const ASG_ID = '0b5f4c1e-2a3d-4e6f-8a9b-1c2d3e4f5a6b';
const SOL_ID = '6f1c2a7e-4b2d-4c55-9a7b-1d2e3f4a5b6c';
const post = (
  a: Hono,
  accion: string,
  body?: unknown,
  ids = `${ASG_ID}/solicitudes-cambio/${SOL_ID}`,
) =>
  a.request(`/assignments/${ids}/${accion}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const AVISO = {
  tripId: 'trip-1',
  trackingCode: 'BOO-1',
  generadorUserId: 'u-gen',
  asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-c' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /assignments/:id/solicitudes-cambio/:sid/aceptar', () => {
  it('acepta, recalcula la huella si cambió el peso y avisa', async () => {
    aceptarMock.mockResolvedValue({
      ok: true,
      campos: ['weight_kg'],
      aviso: AVISO,
      vehicleId: 'veh-1',
    });
    const res = await post(app(), 'aceptar');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, solicitud_id: SOL_ID, campos: ['weight_kg'] });
    expect(aceptarMock).toHaveBeenCalledWith(expect.anything(), {
      assignmentId: ASG_ID,
      empresaId: 'emp-t',
      userId: 'user-1',
      solicitudId: SOL_ID,
    });
    expect(metricasMock).toHaveBeenCalledWith(
      expect.objectContaining({ tripId: 'trip-1', vehicleId: 'veh-1' }),
    );
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: AVISO.asignacion,
      evento: 'cambio_aceptado',
    });
  });

  it('una ventana sola no recalcula la huella', async () => {
    aceptarMock.mockResolvedValueOnce({
      ok: true,
      campos: ['pickup_window'],
      aviso: AVISO,
      vehicleId: 'veh-1',
    });
    await post(app(), 'aceptar');
    expect(metricasMock).not.toHaveBeenCalled();
  });

  it('si el post-commit falla, la aceptación responde 200 igual', async () => {
    aceptarMock.mockResolvedValue({
      ok: true,
      campos: ['weight_kg'],
      aviso: AVISO,
      vehicleId: null,
    });
    metricasMock.mockRejectedValueOnce(new Error('routes caído'));
    notifyMock.mockRejectedValueOnce(new Error('push caído'));
    expect((await post(app(), 'aceptar')).status).toBe(200);
  });

  it.each([
    [
      { ok: false, code: 'assignment_not_found' },
      404,
      { error: 'assignment_not_found', code: 'assignment_not_found' },
    ],
    [
      { ok: false, code: 'solicitud_not_found' },
      404,
      { error: 'solicitud_not_found', code: 'solicitud_not_found' },
    ],
    [
      { ok: false, code: 'solicitud_no_vigente' },
      409,
      { error: 'solicitud_no_vigente', code: 'solicitud_no_vigente' },
    ],
    [
      { ok: false, code: 'solicitud_invalidada', motivo: 'datos_cambiaron' },
      409,
      { error: 'solicitud_invalidada', code: 'solicitud_invalidada', motivo: 'datos_cambiaron' },
    ],
    [
      { ok: false, code: 'excede_capacidad_vehiculo', capacidadKg: 5000, pesoKg: 8000 },
      422,
      {
        error: 'excede_capacidad_vehiculo',
        code: 'excede_capacidad_vehiculo',
        capacidad_kg: 5000,
        peso_kg: 8000,
      },
    ],
  ])('resultado %j → %i', async (resultado, status, body) => {
    aceptarMock.mockResolvedValue(resultado);
    const res = await post(app(), 'aceptar');
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(body);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('programada con el contrato desactivado entre solicitud y respuesta → 422', async () => {
    aceptarMock.mockResolvedValue({ ok: false, code: 'contrato_programado_no_habilitado' });
    const res = await post(app(), 'aceptar');
    expect(res.status).toBe(422);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('conductor o despachador sin permiso → 403, sin llamar al servicio', async () => {
    for (const a of [app('conductor'), app('despachador'), app('visualizador')]) {
      const res = await post(a, 'aceptar');
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe('capability_denied');
    }
    expect(aceptarMock).not.toHaveBeenCalled();
    aceptarMock.mockResolvedValue({ ok: false, code: 'solicitud_no_vigente' });
    expect((await post(app('despachador', true), 'aceptar')).status).toBe(409);
  });
});

describe('POST /assignments/:id/solicitudes-cambio/:sid/rechazar', () => {
  it('rechaza con motivo y avisa', async () => {
    rechazarMock.mockResolvedValue({ ok: true, aviso: AVISO });
    const res = await post(app(), 'rechazar', { reason: 'El camión no da' });
    expect(res.status).toBe(200);
    expect(rechazarMock).toHaveBeenCalledWith(expect.anything(), {
      assignmentId: ASG_ID,
      empresaId: 'emp-t',
      userId: 'user-1',
      solicitudId: SOL_ID,
      reason: 'El camión no da',
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.anything(), {
      tripId: 'trip-1',
      asignacion: AVISO.asignacion,
      evento: 'cambio_rechazado',
    });
  });

  it('sin motivo también; no vigente → 409; ajena → 404; motivo largo → 400', async () => {
    rechazarMock.mockResolvedValueOnce({ ok: true, aviso: AVISO });
    expect((await post(app(), 'rechazar', {})).status).toBe(200);
    rechazarMock.mockResolvedValueOnce({ ok: false, code: 'solicitud_no_vigente' });
    expect((await post(app(), 'rechazar', {})).status).toBe(409);
    rechazarMock.mockResolvedValueOnce({ ok: false, code: 'assignment_not_found' });
    expect((await post(app(), 'rechazar', {})).status).toBe(404);
    expect((await post(app(), 'rechazar', { reason: 'x'.repeat(501) })).status).toBe(400);
  });

  it('el conductor no rechaza', async () => {
    expect((await post(app('conductor'), 'rechazar', {})).status).toBe(403);
    expect(rechazarMock).not.toHaveBeenCalled();
  });
});

describe('ids mal formados', () => {
  it('un :id o :sid que no es UUID responde 404 sin llamar al servicio', async () => {
    expect((await post(app(), 'aceptar', undefined, `x/solicitudes-cambio/${SOL_ID}`)).status).toBe(
      404,
    );
    expect((await post(app(), 'rechazar', {}, `${ASG_ID}/solicitudes-cambio/abc`)).status).toBe(
      404,
    );
    expect(aceptarMock).not.toHaveBeenCalled();
    expect(rechazarMock).not.toHaveBeenCalled();
  });
});
