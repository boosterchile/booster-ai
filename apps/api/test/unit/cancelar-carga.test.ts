import { getTableName } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// La ruta sigue a la asignación (ADR-088): aquí solo se comprueba que se pide.
const sincronizarRutaMock = vi.hoisted(() =>
  vi.fn(async () => ({ tipo: 'sin_cambios' as const, rutaId: 'ruta-1' })),
);
vi.mock('../../src/services/sincronizar-ruta-de-asignacion.js', () => ({
  sincronizarRutaDeAsignacion: sincronizarRutaMock,
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

const { cancelarCarga } = await import('../../src/services/cancelar-carga.js');

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

const TRIP = 'e3b8c1d2-0000-4000-8000-000000000100';
const EMPRESA = 'e3b8c1d2-0000-4000-8000-000000000300';
const USER = 'e3b8c1d2-0000-4000-8000-000000000600';
const SOL = 'e3b8c1d2-0000-4000-8000-000000000700';

interface Escenario {
  viaje: { status: string; trackingCode: string } | null;
  asignacion?: { id: string; empresaId: string; driverUserId: string | null } | null;
  /** Filas que devuelve cada UPDATE … RETURNING, en orden (CAS). */
  updates?: Array<unknown[]>;
}

/**
 * Stub de la tx: SELECT del viaje y de la asignación (FOR UPDATE), UPDATEs con
 * RETURNING (CAS) e INSERT del evento.
 */
function makeDb(e: Escenario) {
  const sets: Array<{ tabla: string; valores: Record<string, unknown> }> = [];
  const eventos: Array<Record<string, unknown>> = [];
  const colaUpdates = [...(e.updates ?? [])];
  const select = vi.fn(() => {
    let tabla = '';
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((t: unknown) => {
      tabla = getTableName(t as never);
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.for = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      if (tabla === 'viajes') {
        return e.viaje ? [e.viaje] : [];
      }
      if (tabla === 'asignaciones') {
        return e.asignacion ? [e.asignacion] : [];
      }
      return [];
    });
    return chain;
  });
  const update = vi.fn((t: unknown) => {
    const tabla = getTableName(t as never);
    return {
      set: vi.fn((valores: Record<string, unknown>) => {
        sets.push({ tabla, valores });
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => colaUpdates.shift() ?? []) })),
        };
      }),
    };
  });
  const insert = vi.fn(() => ({
    values: vi.fn(async (v: Record<string, unknown>) => {
      eventos.push(v);
    }),
  }));
  const tx = { select, update, insert };
  const db = { transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { db: db as never, sets, eventos };
}

const cancelar = (db: never, reason?: string) =>
  cancelarCarga(
    { db, logger },
    { tripId: TRIP, empresaId: EMPRESA, userId: USER, ...(reason ? { reason } : {}) },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancelarCarga — antes del match (anular)', () => {
  it('anula, expira las ofertas pendientes y registra el evento con tipo anulación', async () => {
    const { db, sets, eventos } = makeDb({
      viaje: { status: 'ofertas_enviadas', trackingCode: 'BOO-1' },
      updates: [[{ id: TRIP }], [{ id: 'o1' }, { id: 'o2' }]],
    });
    const r = await cancelar(db);
    expect(r).toEqual({ ok: true, tipo: 'anulacion', ofertasInvalidadas: 2, asignacion: null });
    expect(sets.map((s) => s.tabla)).toEqual(['viajes', 'ofertas']);
    expect(eventos[0]).toMatchObject({
      eventType: 'cancelado',
      recordedByUserId: USER,
      payload: {
        tipo: 'anulacion',
        actor: 'generador_carga',
        previous_status: 'ofertas_enviadas',
        invalidated_offers: 2,
      },
    });
  });

  it('el motivo es opcional al anular (§12-P6)', async () => {
    const { db, eventos } = makeDb({
      viaje: { status: 'esperando_match', trackingCode: 'BOO-1' },
      updates: [[{ id: TRIP }], []],
    });
    await cancelar(db, 'Ya no la necesito');
    expect(eventos[0]?.payload).toMatchObject({ reason: 'Ya no la necesito' });
  });
});

describe('cancelarCarga — después del match (cancelar)', () => {
  const ASG = { id: 'asg-1', empresaId: 'emp-t', driverUserId: 'u-c' };

  it('exige motivo (§12-P6), sin escribir nada', async () => {
    const { db, sets, eventos } = makeDb({
      viaje: { status: 'asignado', trackingCode: 'BOO-1' },
      asignacion: ASG,
    });
    expect(await cancelar(db)).toEqual({ ok: false, code: 'reason_required' });
    expect(sets).toHaveLength(0);
    expect(eventos).toHaveLength(0);
  });

  it('cancela viaje y asignación, escribe las columnas de cancelación y devuelve la asignación', async () => {
    const { db, sets, eventos } = makeDb({
      viaje: { status: 'asignado', trackingCode: 'BOO-1' },
      asignacion: ASG,
      updates: [[{ id: TRIP }], [{ id: 'asg-1' }]],
    });
    const r = await cancelar(db, 'El cliente postergó el pedido');
    expect(r).toEqual({
      ok: true,
      tipo: 'cancelacion',
      ofertasInvalidadas: 0,
      asignacion: ASG,
      motivo: 'El cliente postergó el pedido',
    });
    expect(sets[0]).toMatchObject({ tabla: 'viajes', valores: { status: 'cancelado' } });
    expect(sets[1]).toMatchObject({
      tabla: 'asignaciones',
      valores: {
        status: 'cancelado',
        cancelledByActor: 'generador_carga',
        cancellationReason: 'El cliente postergó el pedido',
      },
    });
    expect(sets[1]?.valores.cancelledAt).toBeInstanceOf(Date);
    expect(eventos[0]).toMatchObject({
      eventType: 'cancelado',
      assignmentId: 'asg-1',
      payload: {
        tipo: 'cancelacion',
        actor: 'generador_carga',
        previous_status: 'asignado',
        assignment_id: 'asg-1',
        reason: 'El cliente postergó el pedido',
      },
    });
    expect(sincronizarRutaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origen: 'carga_cancelada' }),
    );
  });

  it('invalida la solicitud de cambio pendiente con su evento (§6.6)', async () => {
    const { db, sets, eventos } = makeDb({
      viaje: { status: 'asignado', trackingCode: 'BOO-1' },
      asignacion: ASG,
      updates: [[{ id: TRIP }], [{ id: 'asg-1' }], [{ id: SOL, assignmentId: 'asg-1' }]],
    });
    await cancelar(db, 'motivo');
    expect(sets[2]).toMatchObject({
      tabla: 'solicitudes_cambio_viaje',
      valores: { status: 'invalidada', invalidationReason: 'viaje_cancelado' },
    });
    expect(eventos.map((e) => e.eventType)).toEqual(['cambio_respondido', 'cancelado']);
    expect(eventos[0]?.payload).toEqual({
      solicitud_id: SOL,
      resultado: 'invalidado',
      motivo_invalidacion: 'viaje_cancelado',
    });
  });

  it('si el CAS de la asignación no aplica (ya recogió), no cancela: trip_not_cancellable', async () => {
    const { db, eventos } = makeDb({
      viaje: { status: 'asignado', trackingCode: 'BOO-1' },
      asignacion: ASG,
      updates: [[{ id: TRIP }], []],
    });
    await expect(cancelar(db, 'motivo')).rejects.toThrow(/no se pudo cancelar la asignación/);
    expect(eventos).toHaveLength(0);
  });
});

describe('cancelarCarga — estados que no se cancelan', () => {
  it.each(['en_proceso', 'entregado', 'cancelado', 'expirado'])(
    '%s → trip_not_cancellable con el estado',
    async (status) => {
      const { db, sets } = makeDb({ viaje: { status, trackingCode: 'BOO-1' } });
      expect(await cancelar(db, 'x')).toEqual({
        ok: false,
        code: 'trip_not_cancellable',
        currentStatus: status,
      });
      expect(sets).toHaveLength(0);
    },
  );

  it('viaje inexistente o de otra empresa → trip_not_found', async () => {
    const { db } = makeDb({ viaje: null });
    expect(await cancelar(db, 'x')).toEqual({ ok: false, code: 'trip_not_found' });
  });
});
