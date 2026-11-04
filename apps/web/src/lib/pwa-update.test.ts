import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PWA_RELOAD_ACK,
  PWA_RELOAD_GUARD_MS,
  PWA_RELOAD_MARK,
  PWA_RELOAD_PING,
  type PwaUpdateEnv,
  type PwaWorkerMessage,
  installPwaUpdate,
  mensajeReload,
  recargarClientesSinAck,
} from './pwa-update.js';

interface Harness {
  env: PwaUpdateEnv;
  fireController: () => void;
  fireMessage: (data: unknown) => void;
  fireVisibility: () => void;
  setVisibility: (state: DocumentVisibilityState) => void;
  update: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
  scheduled: Array<{ fn: () => void; ms: number }>;
  session: Map<string, string>;
}

function harness(controller: object | null = {}): Harness {
  const controllerListeners: Array<(event?: PwaWorkerMessage) => void> = [];
  const messageListeners: Array<(event?: PwaWorkerMessage) => void> = [];
  const visibilityListeners: Array<() => void> = [];
  const session = new Map<string, string>();
  const scheduled: Array<{ fn: () => void; ms: number }> = [];
  const update = vi.fn(async () => undefined);
  const reload = vi.fn();
  const report = vi.fn();
  const current: object | null = controller;
  let visibility: DocumentVisibilityState = 'visible';
  const env: PwaUpdateEnv = {
    serviceWorker: {
      get controller() {
        return current;
      },
      addEventListener: (type, listener) => {
        if (type === 'message') {
          messageListeners.push(listener);
          return;
        }
        controllerListeners.push(listener);
      },
      ready: Promise.resolve({ update }),
    },
    reply: vi.fn(),
    location: { reload },
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (_type, listener) => {
        visibilityListeners.push(listener);
      },
    },
    session: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => {
        session.set(key, value);
      },
      removeItem: (key) => {
        session.delete(key);
      },
    },
    report,
    schedule: (fn, ms) => {
      scheduled.push({ fn, ms });
    },
  };
  return {
    env,
    fireController: () => {
      for (const listener of controllerListeners) {
        listener();
      }
    },
    fireMessage: (data) => {
      for (const listener of messageListeners) {
        listener({ data });
      }
    },
    fireVisibility: () => {
      for (const listener of visibilityListeners) {
        listener();
      }
    },
    setVisibility: (state) => {
      visibility = state;
    },
    update,
    reload,
    report,
    scheduled,
    session,
  };
}

describe('installPwaUpdate — controllerchange', () => {
  it('no recarga la primera vez que un worker toma una página sin controller', () => {
    const h = harness(null);
    installPwaUpdate(h.env);
    h.fireController();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.session.has(PWA_RELOAD_MARK)).toBe(false);
  });

  it('recarga una vez cuando ya había un controller y deja la marca', () => {
    const h = harness({});
    installPwaUpdate(h.env);
    h.fireController();
    h.fireController();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.session.get(PWA_RELOAD_MARK)).toBe('1');
  });

  it('ignora el controllerchange que llega justo después del reload', () => {
    const h = harness({});
    h.session.set(PWA_RELOAD_MARK, '1');
    installPwaUpdate(h.env);
    h.fireController();
    expect(h.reload).not.toHaveBeenCalled();
    expect(h.scheduled).toEqual([{ fn: expect.any(Function), ms: PWA_RELOAD_GUARD_MS }]);
    h.scheduled[0]?.fn();
    expect(h.session.has(PWA_RELOAD_MARK)).toBe(false);
    h.fireController();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('no borra la marca si otro evento ya la consumió antes del plazo', () => {
    const h = harness({});
    h.session.set(PWA_RELOAD_MARK, '1');
    installPwaUpdate(h.env);
    h.session.delete(PWA_RELOAD_MARK);
    h.scheduled[0]?.fn();
    expect(h.report).not.toHaveBeenCalled();
  });
});

describe('un deploy, una recarga', () => {
  it('la pestaña contesta el ping y controllerchange recarga una sola vez', async () => {
    const h = harness({});
    const acks = new Set<string>();
    const navegadas: string[] = [];
    let ping: unknown;
    h.env.reply = (message) => {
      const mensaje = mensajeReload(message);
      if (mensaje?.type === PWA_RELOAD_ACK) {
        acks.add(mensaje.id);
      }
    };
    installPwaUpdate(h.env);

    const tarea = recargarClientesSinAck(
      [
        {
          id: 'tab-1',
          url: 'https://app.boosterchile.com/app',
          postMessage: (message) => {
            ping = message;
            h.fireMessage(message);
          },
          navigate: async (url) => {
            navegadas.push(url);
          },
        },
      ],
      async () => acks,
    );
    h.fireController();
    h.fireController();
    await tarea;

    expect(ping).toEqual({ type: PWA_RELOAD_PING, id: 'tab-1' });
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(navegadas).toEqual([]);
    expect(acks.has('tab-1')).toBe(true);
  });

  it('sin respuesta, el fallback navega una vez y la primera toma de control no recarga', async () => {
    const h = harness(null);
    installPwaUpdate(h.env);
    const navegadas: string[] = [];
    await recargarClientesSinAck(
      [
        {
          id: 'vieja',
          url: 'https://app.boosterchile.com/app',
          navigate: async (url) => {
            navegadas.push(url);
          },
        },
      ],
      async () => new Set<string>(),
    );
    h.fireController();
    expect(h.reload).not.toHaveBeenCalled();
    expect(navegadas).toEqual(['https://app.boosterchile.com/app']);
  });

  it('reporta si la respuesta al service worker falla', () => {
    const h = harness({});
    const fallo = new Error('puerto cerrado');
    h.env.reply = () => {
      throw fallo;
    };
    installPwaUpdate(h.env);
    h.fireMessage({ type: PWA_RELOAD_PING, id: 'tab-1' });
    expect(h.report).toHaveBeenCalledWith(fallo);
  });
});

describe('installPwaUpdate — visibilitychange', () => {
  it('pide registration.update() solo al volver a visible', async () => {
    const h = harness({});
    installPwaUpdate(h.env);
    h.setVisibility('hidden');
    h.fireVisibility();
    expect(h.update).not.toHaveBeenCalled();
    h.setVisibility('visible');
    h.fireVisibility();
    h.fireVisibility();
    await Promise.resolve();
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it('reporta si update() rechaza', async () => {
    const h = harness({});
    const fallo = new Error('offline');
    h.update.mockRejectedValueOnce(fallo);
    installPwaUpdate(h.env);
    h.fireVisibility();
    await Promise.resolve();
    expect(h.update).toHaveBeenCalledTimes(1);
    await (h.update.mock.results[0]?.value as Promise<unknown>).catch(() => undefined);
    await Promise.resolve();
    expect(h.report).toHaveBeenCalledWith(fallo);
  });
});

describe('installPwaUpdate — sessionStorage', () => {
  it('recarga igual si la marca no se puede leer ni escribir, y lo reporta', () => {
    const h = harness({});
    h.env.session.getItem = () => {
      throw new Error('lectura');
    };
    h.env.session.setItem = () => {
      throw new Error('escritura');
    };
    installPwaUpdate(h.env);
    h.fireController();
    h.fireController();
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.report).toHaveBeenCalledTimes(3);
  });

  it('reporta si no puede borrar la marca al vencer el plazo', () => {
    const h = harness({});
    h.session.set(PWA_RELOAD_MARK, '1');
    h.env.session.removeItem = () => {
      throw new Error('borrar');
    };
    installPwaUpdate(h.env);
    h.scheduled[0]?.fn();
    expect(h.report).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('installPwaUpdate — reloj por defecto', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('borra la marca a los 10 s', () => {
    vi.useFakeTimers();
    const h = harness({});
    h.session.set(PWA_RELOAD_MARK, '1');
    const { schedule: _schedule, ...sinReloj } = h.env;
    installPwaUpdate(sinReloj);
    expect(h.session.get(PWA_RELOAD_MARK)).toBe('1');
    vi.advanceTimersByTime(PWA_RELOAD_GUARD_MS);
    expect(h.session.has(PWA_RELOAD_MARK)).toBe(false);
  });
});
