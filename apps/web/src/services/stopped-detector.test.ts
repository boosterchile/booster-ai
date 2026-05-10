import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type StoppedState,
  createStoppedDetector,
  nextState,
  speedMpsToKmh,
} from './stopped-detector.js';

describe('speedMpsToKmh', () => {
  it('null/undefined → null', () => {
    expect(speedMpsToKmh(null)).toBeNull();
    expect(speedMpsToKmh(undefined)).toBeNull();
  });

  it('NaN → null', () => {
    expect(speedMpsToKmh(Number.NaN)).toBeNull();
  });

  it('negativo → null (browser dice "no sé")', () => {
    expect(speedMpsToKmh(-1)).toBeNull();
  });

  it('0 m/s → 0 km/h', () => {
    expect(speedMpsToKmh(0)).toBe(0);
  });

  it('10 m/s → 36 km/h', () => {
    expect(speedMpsToKmh(10)).toBe(36);
  });

  it('27.78 m/s ≈ 100 km/h', () => {
    const kmh = speedMpsToKmh(27.78);
    expect(kmh).toBeCloseTo(100, 1);
  });
});

describe('nextState (histeresis)', () => {
  it('null observado → no-change (sin lectura)', () => {
    expect(nextState('stopped', null)).toBe('no-change');
    expect(nextState('moving', null)).toBe('no-change');
    expect(nextState('unknown', null)).toBe('no-change');
  });

  it('≤ 3 km/h desde unknown → stopped', () => {
    expect(nextState('unknown', 0)).toBe('stopped');
    expect(nextState('unknown', 3)).toBe('stopped');
  });

  it('≤ 3 km/h desde stopped → no-change', () => {
    expect(nextState('stopped', 1)).toBe('no-change');
  });

  it('≤ 3 km/h desde moving → stopped', () => {
    expect(nextState('moving', 2)).toBe('stopped');
  });

  it('≥ 8 km/h desde stopped → moving', () => {
    expect(nextState('stopped', 8)).toBe('moving');
    expect(nextState('stopped', 50)).toBe('moving');
  });

  it('≥ 8 km/h desde moving → no-change', () => {
    expect(nextState('moving', 30)).toBe('no-change');
  });

  it('banda muerta (3 < kmh < 8) → no-change para preservar estado', () => {
    expect(nextState('stopped', 4)).toBe('no-change');
    expect(nextState('stopped', 7)).toBe('no-change');
    expect(nextState('moving', 4)).toBe('no-change');
    expect(nextState('moving', 7)).toBe('no-change');
  });

  it('banda muerta desde unknown → no-change (esperamos certeza)', () => {
    expect(nextState('unknown', 5)).toBe('no-change');
  });
});

describe('createStoppedDetector', () => {
  /** Stub instalable de Geolocation API. */
  function makeGeoMock() {
    let nextWatchId = 1;
    const watchers: Array<{
      id: number;
      success: PositionCallback;
      error: PositionErrorCallback | null;
    }> = [];

    const watchPosition = vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback | null) => {
        const id = nextWatchId++;
        watchers.push({ id, success, error: error ?? null });
        return id;
      },
    );
    const clearWatch = vi.fn((id: number) => {
      const idx = watchers.findIndex((w) => w.id === id);
      if (idx >= 0) {
        watchers.splice(idx, 1);
      }
    });
    return {
      geo: {
        watchPosition,
        clearWatch,
        getCurrentPosition: vi.fn(),
      } as unknown as Geolocation,
      emitPos: (speedMps: number | null) => {
        const pos = {
          coords: { speed: speedMps as number, latitude: 0, longitude: 0 },
          timestamp: Date.now(),
        } as unknown as GeolocationPosition;
        for (const w of watchers) {
          w.success(pos);
        }
      },
      emitError: (code: number) => {
        const err = {
          code,
          message: 'mock',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        } as unknown as GeolocationPositionError;
        for (const w of watchers) {
          w.error?.(err);
        }
      },
      watchers,
      spies: { watchPosition, clearWatch },
    };
  }

  let scheduledTimers: Array<{ id: number; cb: () => void; ms: number }> = [];
  let nextTimerId = 1;
  const fakeSetTimeout = ((cb: () => void, ms: number) => {
    const id = nextTimerId++;
    scheduledTimers.push({ id, cb, ms });
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const fakeClearTimeout = ((id: number) => {
    const idx = scheduledTimers.findIndex((t) => t.id === id);
    if (idx >= 0) {
      scheduledTimers.splice(idx, 1);
    }
  }) as typeof clearTimeout;
  const flushTimers = (): void => {
    while (scheduledTimers.length > 0) {
      const t = scheduledTimers.shift();
      t?.cb();
    }
  };

  beforeEach(() => {
    scheduledTimers = [];
    nextTimerId = 1;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('estado inicial: unknown', () => {
    const { geo } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });
    expect(det.getState()).toBe('unknown');
  });

  it('sin geo (null) → unknown perpetuo', () => {
    const det = createStoppedDetector({
      geolocation: null,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });
    expect(det.getState()).toBe('unknown');
  });

  it('observación stopped sostenida → state=stopped tras HOLD_MS', () => {
    const { geo, emitPos } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
      holdMs: 4000,
    });

    emitPos(0); // 0 m/s = 0 km/h
    expect(det.getState()).toBe('unknown'); // todavía pending

    flushTimers();
    expect(det.getState()).toBe('stopped');
  });

  it('observación moving sostenida → state=moving tras HOLD_MS', () => {
    const { geo, emitPos } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitPos(15); // 15 m/s = 54 km/h
    flushTimers();
    expect(det.getState()).toBe('moving');
  });

  it('flap entre stopped/moving → no-change si el opuesto NO se sostiene', () => {
    const { geo, emitPos } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitPos(0); // pending stopped
    flushTimers();
    expect(det.getState()).toBe('stopped');

    // Spike de 10 km/h por una sola lectura, luego vuelve a parado.
    emitPos(2.78); // 10 km/h → pending moving
    expect(det.getState()).toBe('stopped'); // todavía pending, no aplicado
    emitPos(0); // de nuevo stopped → cancela pending
    flushTimers();
    expect(det.getState()).toBe('stopped'); // se mantuvo
  });

  it('banda muerta (5 km/h) preserva el estado', () => {
    const { geo, emitPos } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitPos(0); // → stopped
    flushTimers();
    expect(det.getState()).toBe('stopped');

    emitPos(1.4); // 5 km/h, banda muerta
    flushTimers();
    expect(det.getState()).toBe('stopped'); // no cambia
  });

  it('PERMISSION_DENIED → state=denied + clearWatch', () => {
    const { geo, emitError, spies } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitError(1); // PERMISSION_DENIED
    expect(det.getState()).toBe('denied');
    expect(spies.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('POSITION_UNAVAILABLE / TIMEOUT NO afectan state', () => {
    const { geo, emitError } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitError(2); // POSITION_UNAVAILABLE
    emitError(3); // TIMEOUT
    expect(det.getState()).toBe('unknown');
  });

  it('subscribe recibe state actual + cambios; unsubscribe deja de recibir', () => {
    const { geo, emitPos } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    const states: StoppedState[] = [];
    const unsub = det.subscribe((s) => states.push(s));
    expect(states).toEqual(['unknown']);

    emitPos(0);
    flushTimers();
    expect(states).toEqual(['unknown', 'stopped']);

    unsub();
    emitPos(15);
    flushTimers();
    expect(states).toEqual(['unknown', 'stopped']); // sin cambios post-unsub
  });

  it('stop() cancela watch + pending timer; idempotente', () => {
    const { geo, emitPos, spies } = makeGeoMock();
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });

    emitPos(0); // pending stopped
    expect(scheduledTimers.length).toBe(1);

    det.stop();
    expect(spies.clearWatch).toHaveBeenCalledTimes(1);
    expect(scheduledTimers.length).toBe(0); // pending cancelado

    det.stop(); // idempotente — no doble-clearWatch
    expect(spies.clearWatch).toHaveBeenCalledTimes(1);
  });

  it('watchPosition throws (HTTPS sin permisos) → state=denied', () => {
    const geo = {
      watchPosition: vi.fn(() => {
        throw new DOMException('insecure', 'SecurityError');
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation;
    const det = createStoppedDetector({
      geolocation: geo,
      setTimeoutFn: fakeSetTimeout,
      clearTimeoutFn: fakeClearTimeout,
    });
    expect(det.getState()).toBe('denied');
  });
});
