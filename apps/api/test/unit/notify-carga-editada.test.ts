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

const { notifyCargaEditada } = await import('../../src/services/notify-carga-editada.js');

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
    chain.limit = vi.fn(async () => (n === 0 ? [{ trackingCode }] : miembros));
    return chain;
  });
  return { select } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('notifyCargaEditada', () => {
  it('avisa por push a quienes aceptan ofertas y al conductor, una vez cada uno', async () => {
    const db = makeDb([{ userId: 'u-dueno' }, { userId: 'u-desp' }, { userId: 'u-cond' }]);
    const r = await notifyCargaEditada(
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
    const r = await notifyCargaEditada(
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
    const r = await notifyCargaEditada(
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

describe('notifyCargaEditada — cancelación', () => {
  it('avisa la cancelación con el motivo', async () => {
    const db = makeDb([{ userId: 'u-dueno' }]);
    await notifyCargaEditada(
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
