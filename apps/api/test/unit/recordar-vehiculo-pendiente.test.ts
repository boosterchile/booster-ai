import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
});

const { recordarVehiculoPendiente } = await import(
  '../../src/services/recordar-vehiculo-pendiente.js'
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

/**
 * Stub de BD: cada etapa (24h / 2h / ventana) hace su propia tx con
 * select…for update + update returning (claim). Si el aviso falla o
 * `enviados===0`, el job limpia la marca con `db.update` fuera de la tx.
 */
function makeDb(colas: {
  '24h'?: {
    candidatas: Array<{ id: string }>;
    tomadas: Array<{
      id: string;
      tripId: string;
      empresaId: string;
      driverUserId: string | null;
    }>;
  };
  '2h'?: {
    candidatas: Array<{ id: string }>;
    tomadas: Array<{
      id: string;
      tripId: string;
      empresaId: string;
      driverUserId: string | null;
    }>;
  };
  ventana_iniciada?: {
    candidatas: Array<{ id: string }>;
    tomadas: Array<{
      id: string;
      tripId: string;
      empresaId: string;
      driverUserId: string | null;
    }>;
  };
}) {
  const etapas = ['24h', '2h', 'ventana_iniciada'] as const;
  let etapaIdx = 0;
  const forFns: Array<ReturnType<typeof vi.fn>> = [];
  const updateFns: Array<ReturnType<typeof vi.fn>> = [];
  const liberaciones: Array<{ set: unknown }> = [];

  const updateTop = vi.fn(() => ({
    set: vi.fn((vals: unknown) => {
      liberaciones.push({ set: vals });
      return { where: vi.fn(async () => []) };
    }),
  }));

  const db = {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      const etapa = etapas[etapaIdx++];
      const cola = etapa
        ? (colas[etapa] ?? { candidatas: [], tomadas: [] })
        : { candidatas: [], tomadas: [] };
      const forFn = vi.fn(async () => cola.candidatas);
      forFns.push(forFn);
      const updateTx = vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(async () => cola.tomadas) })),
        })),
      }));
      updateFns.push(updateTx);
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn(() => chain);
      chain.innerJoin = vi.fn(() => chain);
      chain.where = vi.fn(() => chain);
      chain.orderBy = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.for = forFn;
      const tx = {
        select: vi.fn(() => chain),
        update: updateTx,
      };
      return cb(tx);
    }),
    update: updateTop,
  };

  return { db: db as never, forFns, updateFns, updateTop, liberaciones };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordarVehiculoPendiente (matching-desde-la-carga §3.9 / §11-3)', () => {
  const ahora = new Date('2026-11-13T15:00:00.000Z');

  it('sin candidatas en ninguna etapa no marca ni avisa', async () => {
    const { db, updateFns } = makeDb({});
    const avisar = vi.fn();
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 0,
      avisadosGenerador: 0,
      fallidos: 0,
    });
    for (const u of updateFns) {
      expect(u).not.toHaveBeenCalled();
    }
    expect(avisar).not.toHaveBeenCalled();
  });

  it('24 h antes: recuerda a la oficina y marca la etapa (idempotencia)', async () => {
    const { db, forFns } = makeDb({
      '24h': {
        candidatas: [{ id: 'a1' }],
        tomadas: [{ id: 'a1', tripId: 't1', empresaId: 'e1', driverUserId: null }],
      },
    });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 1,
      avisadosGenerador: 0,
      fallidos: 0,
    });
    expect(forFns[0]).toHaveBeenCalledWith('update', { skipLocked: true });
    expect(avisar).toHaveBeenCalledWith(expect.anything(), {
      tripId: 't1',
      asignacion: { id: 'a1', empresaId: 'e1', driverUserId: null },
      evento: 'vehiculo_pendiente_24h',
    });
  });

  it('2 h antes: recuerda a la oficina con el evento de 2 h', async () => {
    const { db } = makeDb({
      '2h': {
        candidatas: [{ id: 'a2' }],
        tomadas: [{ id: 'a2', tripId: 't2', empresaId: 'e2', driverUserId: 'c1' }],
      },
    });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 1,
      avisadosGenerador: 0,
      fallidos: 0,
    });
    expect(avisar).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ evento: 'vehiculo_pendiente_2h', tripId: 't2' }),
    );
  });

  it('ventana iniciada sin vehículo: avisa al generador una sola vez', async () => {
    const { db } = makeDb({
      ventana_iniciada: {
        candidatas: [{ id: 'a3' }],
        tomadas: [{ id: 'a3', tripId: 't3', empresaId: 'e3', driverUserId: null }],
      },
    });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 0,
      avisadosGenerador: 1,
      fallidos: 0,
    });
    expect(avisar).toHaveBeenCalledWith(expect.anything(), {
      tripId: 't3',
      asignacion: { id: 'a3', empresaId: 'e3', driverUserId: null },
      evento: 'vehiculo_pendiente_vencido',
    });
  });

  it('un aviso que falla cuenta como fallido, limpia la marca y no suma al canal', async () => {
    const { db, updateTop, liberaciones } = makeDb({
      '24h': {
        candidatas: [{ id: 'a1' }],
        tomadas: [{ id: 'a1', tripId: 't1', empresaId: 'e1', driverUserId: null }],
      },
      ventana_iniciada: {
        candidatas: [{ id: 'a3' }],
        tomadas: [{ id: 'a3', tripId: 't3', empresaId: 'e3', driverUserId: null }],
      },
    });
    const avisar = vi.fn(async (_deps, opts: { evento: string }) => {
      if (opts.evento === 'vehiculo_pendiente_24h') {
        throw new Error('push caído');
      }
      return { destinatarios: 1, enviados: 1 };
    });
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 0,
      avisadosGenerador: 1,
      fallidos: 1,
    });
    expect(updateTop).toHaveBeenCalledTimes(1);
    expect(liberaciones[0]?.set).toEqual({ vehicleReminder24hAt: null });
  });

  it('enviados===0 cuenta fallido, limpia la marca y permite reintento', async () => {
    const { db, updateTop, liberaciones } = makeDb({
      '2h': {
        candidatas: [{ id: 'a2' }],
        tomadas: [{ id: 'a2', tripId: 't2', empresaId: 'e2', driverUserId: null }],
      },
    });
    const avisar = vi.fn(async () => ({ destinatarios: 2, enviados: 0 }));
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 0,
      avisadosGenerador: 0,
      fallidos: 1,
    });
    expect(updateTop).toHaveBeenCalledTimes(1);
    expect(liberaciones[0]?.set).toEqual({ vehicleReminder2hAt: null });
  });

  it('aviso útil no limpia la marca (idempotencia en éxito)', async () => {
    const { db, updateTop } = makeDb({
      '24h': {
        candidatas: [{ id: 'a1' }],
        tomadas: [{ id: 'a1', tripId: 't1', empresaId: 'e1', driverUserId: null }],
      },
    });
    const avisar = vi.fn(async () => ({ destinatarios: 1, enviados: 1 }));
    expect(await recordarVehiculoPendiente({ db, logger, now: ahora, avisar })).toEqual({
      recordadosOficina: 1,
      avisadosGenerador: 0,
      fallidos: 0,
    });
    expect(updateTop).not.toHaveBeenCalled();
  });
});
