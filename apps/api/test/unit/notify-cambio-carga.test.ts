import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const sendPushMock = vi.fn(async () => ({ sent: 1, invalidated: 0, errored: 0 }));
vi.mock('../../src/services/web-push.js', () => ({
  sendPushToUser: (...a: unknown[]) => sendPushMock(...(a as [])),
}));

const { notifyCambioCarga } = await import('../../src/services/notify-cambio-carga.js');

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

/**
 * Stub: primer select = el viaje (código de seguimiento); segundo = las
 * membresías de la transportista que pueden aceptar ofertas.
 */
function makeDb(miembros: Array<{ userId: string }>, trackingCode = 'BOO-ABC123') {
  let llamada = 0;
  const select = vi.fn(() => {
    const n = llamada++;
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(async () =>
      n === 0 ? [{ trackingCode, createdByUserId: 'u-gen' }] : miembros,
    );
    return chain;
  });
  return { select } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifyCambioCarga', () => {
  it('avisa por push a quienes aceptan ofertas y al conductor, una vez cada uno', async () => {
    const db = makeDb([{ userId: 'u-dueno' }, { userId: 'u-desp' }, { userId: 'u-cond' }]);
    const r = await notifyCambioCarga(
      { db, logger },
      {
        tripId: 'trip-1',
        asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-cond' },
        evento: 'datos_libres',
      },
    );
    expect(r).toEqual({ destinatarios: 3, enviados: 3 });
    const usuarios = sendPushMock.mock.calls.map((c) => (c[0] as { userId: string }).userId);
    expect(usuarios.sort()).toEqual(['u-cond', 'u-desp', 'u-dueno']);
    const { payload } = sendPushMock.mock.calls[0]?.[0] as {
      payload: { title: string; body: string; tag: string; data: Record<string, string> };
    };
    expect(payload.body).toBe('Se actualizaron los datos de contacto o notas de BOO-ABC123.');
    expect(payload.tag).toBe('viaje:trip-1:datos_libres');
    expect(payload.data).toMatchObject({
      tipo: 'aviso_carga',
      trip_id: 'trip-1',
      assignment_id: 'asg-1',
    });
  });

  it('sin conductor asignado avisa solo a la transportista', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    const r = await notifyCambioCarga(
      { db, logger },
      {
        tripId: 'trip-1',
        asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: null },
        evento: 'datos_libres',
      },
    );
    expect(r).toEqual({ destinatarios: 1, enviados: 1 });
  });

  it('cuenta como no enviado un push que no llegó a ninguna suscripción', async () => {
    sendPushMock.mockResolvedValueOnce({ sent: 0, invalidated: 0, errored: 0 });
    const db = makeDb([{ userId: 'u-dueno' }]);
    const r = await notifyCambioCarga(
      { db, logger },
      {
        tripId: 'trip-1',
        asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-cond' },
        evento: 'datos_libres',
      },
    );
    expect(r).toEqual({ destinatarios: 2, enviados: 1 });
  });
});

describe('notifyCambioCarga — cancelación', () => {
  it('avisa la cancelación con el motivo', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCambioCarga(
      { db, logger },
      {
        tripId: 'trip-1',
        asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-cond' },
        evento: 'cancelacion',
        motivo: 'El cliente postergó el pedido',
      },
    );
    const { payload } = sendPushMock.mock.calls[0]?.[0] as {
      payload: { title: string; body: string; tag: string };
    };
    expect(payload.title).toBe('Servicio cancelado');
    expect(payload.body).toBe(
      'El generador canceló el servicio BOO-ABC123. Motivo: El cliente postergó el pedido. No te presentes a la recogida.',
    );
    expect(payload.tag).toBe('viaje:trip-1:cancelacion');
  });
});

describe('notifyCambioCarga — solicitudes de cambio (§8)', () => {
  const ASG = { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-cond' };
  function avisos(): Map<string, { title: string; body: string; url: string; tag: string }> {
    return new Map(
      sendPushMock.mock.calls.map((c) => {
        const arg = c[0] as {
          userId: string;
          payload: { title: string; body: string; tag: string; data: { url: string } };
        };
        return [
          arg.userId,
          {
            title: arg.payload.title,
            body: arg.payload.body,
            url: arg.payload.data.url,
            tag: arg.payload.tag,
          },
        ];
      }),
    );
  }

  it('solicitud creada: la oficina debe responder y el conductor espera, sin datos propuestos', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCambioCarga(
      { db, logger },
      { tripId: 'trip-1', asignacion: ASG, evento: 'cambio_solicitado' },
    );
    const a = avisos();
    expect(a.get('u-dueno')?.body).toBe(
      'El generador propone un cambio en BOO-ABC123. Respóndelo antes de la recogida.',
    );
    expect(a.get('u-cond')?.body).toBe(
      'Hay un cambio pendiente en BOO-ABC123. Espera la respuesta de tu transportista antes de recoger.',
    );
    expect(a.has('u-gen')).toBe(false);
    expect(a.get('u-dueno')?.tag).toBe('viaje:trip-1:cambio_solicitado');
  });

  it('aceptado: avisa al generador (a su carga) y al conductor, no a la oficina', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCambioCarga(
      { db, logger },
      { tripId: 'trip-1', asignacion: ASG, evento: 'cambio_aceptado' },
    );
    const a = avisos();
    expect(a.get('u-gen')).toMatchObject({
      body: 'Cambiaron los datos del servicio BOO-ABC123.',
      url: '/app/cargas/trip-1',
    });
    expect(a.get('u-cond')?.body).toBe('Cambiaron los datos del servicio BOO-ABC123.');
    expect(a.has('u-dueno')).toBe(false);
  });

  it('rechazado: textos distintos para el generador y el conductor', async () => {
    const db = makeDb([]);
    await notifyCambioCarga(
      { db, logger },
      { tripId: 'trip-1', asignacion: ASG, evento: 'cambio_rechazado' },
    );
    const a = avisos();
    expect(a.get('u-gen')?.body).toBe('El transportista rechazó el cambio en BOO-ABC123.');
    expect(a.get('u-cond')?.body).toBe(
      'El servicio BOO-ABC123 sigue sin cambios; ya puedes recoger.',
    );
  });

  it('retirado: oficina y conductor', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCambioCarga(
      { db, logger },
      { tripId: 'trip-1', asignacion: ASG, evento: 'cambio_retirado' },
    );
    const a = avisos();
    expect(a.get('u-dueno')?.body).toBe('El generador retiró el cambio propuesto en BOO-ABC123.');
    expect(a.get('u-cond')?.body).toBe('El generador retiró el cambio propuesto en BOO-ABC123.');
    expect(a.has('u-gen')).toBe(false);
  });

  it('el dueño que también conduce recibe un solo aviso, con el texto de la oficina', async () => {
    const db = makeDb([{ userId: 'u-cond' }]);
    await notifyCambioCarga(
      { db, logger },
      { tripId: 'trip-1', asignacion: ASG, evento: 'cambio_solicitado' },
    );
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(avisos().get('u-cond')?.body).toMatch(/Respóndelo antes de la recogida/);
  });
});

describe('notifyCambioCarga — recordatorio (§8)', () => {
  it('solo a la oficina de la transportista, con su tag propio', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCambioCarga(
      { db, logger },
      {
        tripId: 'trip-1',
        asignacion: { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-cond' },
        evento: 'cambio_recordatorio',
      },
    );
    expect(sendPushMock).toHaveBeenCalledTimes(1);
    const { userId, payload } = sendPushMock.mock.calls[0]?.[0] as {
      userId: string;
      payload: { body: string; tag: string };
    };
    expect(userId).toBe('u-dueno');
    expect(payload.body).toBe(
      'Tienes un cambio sin responder en BOO-ABC123. No se puede confirmar la recogida hasta que respondas.',
    );
    expect(payload.tag).toBe('viaje:trip-1:cambio_recordatorio');
  });
});
