import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const { recordarSolicitudesCambio } = await import(
  '../../src/services/recordar-solicitudes-cambio.js'
);

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

function makeDb(opts: {
  candidatas: Array<{ id: string }>;
  tomadas: Array<{ id: string; tripId: string; assignmentId: string }>;
  asignaciones: Array<{ id: string; empresaId: string; driverUserId: string | null }>;
}) {
  const forFn = vi.fn(async () => opts.candidatas);
  const selectTx = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(() => chain);
    chain.for = forFn;
    return chain;
  });
  const updateTx = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(async () => opts.tomadas) })),
    })),
  }));
  const tx = { select: selectTx, update: updateTx };
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(async () => opts.asignaciones);
    return chain;
  });
  return {
    db: {
      transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
      select,
    } as never,
    forFn,
    updateTx,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordarSolicitudesCambio', () => {
  it('sin pendientes vencidas no marca ni avisa', async () => {
    const { db, updateTx } = makeDb({ candidatas: [], tomadas: [], asignaciones: [] });
    const avisar = vi.fn();
    expect(await recordarSolicitudesCambio({ db, logger, intervaloMin: 60, avisar })).toEqual({
      recordados: 0,
      fallidos: 0,
    });
    expect(updateTx).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('toma con SKIP LOCKED, marca y avisa a la transportista de cada una', async () => {
    const { db, forFn } = makeDb({
      candidatas: [{ id: 's1' }, { id: 's2' }],
      tomadas: [
        { id: 's1', tripId: 't1', assignmentId: 'a1' },
        { id: 's2', tripId: 't2', assignmentId: 'a2' },
      ],
      asignaciones: [
        { id: 'a1', empresaId: 'e1', driverUserId: 'c1' },
        { id: 'a2', empresaId: 'e2', driverUserId: null },
      ],
    });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    expect(await recordarSolicitudesCambio({ db, logger, intervaloMin: 60, avisar })).toEqual({
      recordados: 2,
      fallidos: 0,
    });
    expect(forFn).toHaveBeenCalledWith('update', { skipLocked: true });
    expect(avisar).toHaveBeenCalledWith(expect.anything(), {
      tripId: 't1',
      asignacion: { id: 'a1', empresaId: 'e1', driverUserId: 'c1' },
      evento: 'cambio_recordatorio',
    });
  });

  it('un aviso que falla o una asignación perdida cuentan como fallidos', async () => {
    const { db } = makeDb({
      candidatas: [{ id: 's1' }, { id: 's2' }],
      tomadas: [
        { id: 's1', tripId: 't1', assignmentId: 'a1' },
        { id: 's2', tripId: 't2', assignmentId: 'perdida' },
      ],
      asignaciones: [{ id: 'a1', empresaId: 'e1', driverUserId: null }],
    });
    const avisar = vi.fn(async () => {
      throw new Error('push caído');
    });
    expect(await recordarSolicitudesCambio({ db, logger, intervaloMin: 60, avisar })).toEqual({
      recordados: 0,
      fallidos: 2,
    });
  });
});
