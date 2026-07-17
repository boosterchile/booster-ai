import { describe, expect, it, vi } from 'vitest';
import { buildShutdown, createDrainController } from './drain.js';

function makeLoggerSpy() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child() {
      return this;
    },
  } as never;
  return logger;
}

/**
 * Socket fake mínimo: registra orden de llamadas (write/end/destroy) y
 * permite emitir 'close' a mano — en net real, end() gatilla el FIN y el
 * 'close' llega después; acá lo controlamos.
 */
function makeFakeSocket(opts?: { autoCloseOnEnd?: boolean }) {
  const calls: Array<[string, unknown?]> = [];
  const closeCbs: Array<() => void> = [];
  const socket = {
    end: vi.fn(() => {
      calls.push(['end']);
      if (opts?.autoCloseOnEnd) {
        for (const cb of closeCbs.splice(0)) {
          cb();
        }
      }
    }),
    destroy: vi.fn(() => {
      calls.push(['destroy']);
    }),
    once: (event: string, cb: () => void) => {
      if (event === 'close') {
        closeCbs.push(cb);
      }
    },
  };
  const emitClose = () => {
    for (const cb of closeCbs.splice(0)) {
      cb();
    }
  };
  return { socket, calls, emitClose };
}

describe('createDrainController', () => {
  it('socket idle → drain lo cierra YA con FIN limpio (end, jamás destroy)', async () => {
    const ctl = createDrainController(makeLoggerSpy());
    const { socket, emitClose } = makeFakeSocket();
    ctl.register(socket);

    const p = ctl.drain(1_000);
    expect(socket.end).toHaveBeenCalledTimes(1);
    expect(socket.destroy).not.toHaveBeenCalled();

    emitClose();
    await expect(p).resolves.toEqual({ outcome: 'drained', cerrados: 1, restantes: 0 });
  });

  it('socket con op en vuelo → NO se corta; cierra recién en quiescencia (endOp → 0)', async () => {
    const ctl = createDrainController(makeLoggerSpy());
    const { socket, emitClose } = makeFakeSocket();
    ctl.register(socket);
    ctl.beginOp(socket);

    const p = ctl.drain(1_000);
    expect(socket.end).not.toHaveBeenCalled(); // op en vuelo: intocable

    ctl.endOp(socket); // quiescencia
    expect(socket.end).toHaveBeenCalledTimes(1);
    emitClose();
    await expect(p).resolves.toMatchObject({ outcome: 'drained' });
  });

  it('re-entrada: DOS ops en vuelo (processBuffer concurrente) → cierra solo tras la SEGUNDA', () => {
    const ctl = createDrainController(makeLoggerSpy());
    const { socket } = makeFakeSocket();
    ctl.register(socket);
    ctl.beginOp(socket);
    ctl.beginOp(socket);

    void ctl.drain(1_000);
    ctl.endOp(socket);
    expect(socket.end).not.toHaveBeenCalled(); // aún queda 1 en vuelo
    ctl.endOp(socket);
    expect(socket.end).toHaveBeenCalledTimes(1);
  });

  it('budget excedido → resuelve budget_excedido sin colgar (última red del caller)', async () => {
    const ctl = createDrainController(makeLoggerSpy());
    const { socket } = makeFakeSocket();
    ctl.register(socket);
    ctl.beginOp(socket); // jamás llega endOp

    await expect(ctl.drain(30)).resolves.toEqual({
      outcome: 'budget_excedido',
      cerrados: 0,
      restantes: 1,
    });
  });

  it('sin sockets → drena de inmediato', async () => {
    const ctl = createDrainController(makeLoggerSpy());
    await expect(ctl.drain(1_000)).resolves.toEqual({
      outcome: 'drained',
      cerrados: 0,
      restantes: 0,
    });
  });
});

describe('buildShutdown', () => {
  function makeDeps(overrides?: Partial<Parameters<typeof buildShutdown>[0]>) {
    const ctl = createDrainController(makeLoggerSpy());
    const order: string[] = [];
    const deps = {
      logger: makeLoggerSpy(),
      closeListeners: vi.fn(() => order.push('closeListeners')),
      drainController: ctl,
      drainBudgetMs: 100,
      hardExitMs: 5_000,
      flush: vi.fn(async () => {
        order.push('flush');
      }),
      closePool: vi.fn(async () => {
        order.push('closePool');
      }),
      exit: vi.fn((code: number) => {
        order.push(`exit(${code})`);
      }),
      ...overrides,
    };
    return { deps, ctl: deps.drainController, order };
  }

  it('path graceful COMPLETO: flush() y pool.end() SE EJECUTAN (hoy inalcanzables) y exit(0)', async () => {
    const { deps, ctl, order } = makeDeps();
    const { socket } = makeFakeSocket({ autoCloseOnEnd: true });
    ctl.register(socket);

    const { onSignal } = buildShutdown(deps);
    onSignal('SIGTERM');

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(order).toEqual(['closeListeners', 'flush', 'closePool', 'exit(0)']);
  });

  it('drain excede budget → shutdown SIGUE (flush best-effort) y exit(0) — sin colgar', async () => {
    const { deps, ctl } = makeDeps({ drainBudgetMs: 30 });
    const { socket } = makeFakeSocket();
    ctl.register(socket);
    ctl.beginOp(socket); // jamás quiesce

    const { onSignal } = buildShutdown(deps);
    onSignal('SIGTERM');

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.flush).toHaveBeenCalled();
  });

  it('ÚLTIMA RED: si el shutdown se cuelga (flush nunca resuelve), el hard-exit dispara exit(1)', async () => {
    const { deps } = makeDeps({
      hardExitMs: 50,
      flush: vi.fn(() => new Promise<void>(() => undefined)), // cuelga para siempre
    });
    const { onSignal } = buildShutdown(deps);
    onSignal('SIGTERM');

    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(1));
  });

  it('segunda señal se ignora (shutdown idempotente)', async () => {
    const { deps } = makeDeps();
    const { onSignal } = buildShutdown(deps);
    onSignal('SIGTERM');
    onSignal('SIGINT');
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalled());
    expect(deps.closeListeners).toHaveBeenCalledTimes(1);
  });
});
