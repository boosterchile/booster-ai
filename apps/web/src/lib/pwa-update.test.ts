import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PWA_RELOAD_GUARD_MS,
  PWA_RELOAD_MARK,
  type PwaUpdateEnv,
  installPwaUpdate,
} from './pwa-update.js';

interface Harness {
  env: PwaUpdateEnv;
  fireController: () => void;
  fireVisibility: () => void;
  setVisibility: (state: DocumentVisibilityState) => void;
  update: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
  report: ReturnType<typeof vi.fn>;
  scheduled: Array<{ fn: () => void; ms: number }>;
  session: Map<string, string>;
}

function harness(controller: object | null = {}): Harness {
  const controllerListeners: Array<() => void> = [];
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
      addEventListener: (_type, listener) => {
        controllerListeners.push(listener);
      },
      ready: Promise.resolve({ update }),
    },
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
