import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postDriverPositionSpy = vi.fn();
vi.mock('./driver-position.js', async () => {
  const actual =
    await vi.importActual<typeof import('./driver-position.js')>('./driver-position.js');
  return { ...actual, postDriverPosition: (...a: unknown[]) => postDriverPositionSpy(...a) };
});

const reporter = await import('./driver-position-reporter.js');

const T0 = Date.parse('2026-09-15T12:00:00.000Z');

function fakeGeo() {
  let watchCb: ((p: GeolocationPosition) => void) | null = null;
  const watchPosition = vi.fn(
    (cb: (p: GeolocationPosition) => void, _onError?: (e: GeolocationPositionError) => void) => {
      watchCb = cb;
      return 7;
    },
  );
  const clearWatch = vi.fn();
  const getCurrentPosition = vi.fn();
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch, getCurrentPosition },
    configurable: true,
  });
  const pos = (lat: number, lng: number, tMs: number, accuracy = 8) =>
    ({
      timestamp: tMs,
      coords: {
        latitude: lat,
        longitude: lng,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
    }) as GeolocationPosition;
  return {
    emit: (lat: number, lng: number, tMs: number, accuracy = 8) =>
      watchCb?.(pos(lat, lng, tMs, accuracy)),
    pos,
    watchPosition,
    clearWatch,
    getCurrentPosition,
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  localStorage.clear();
  postDriverPositionSpy.mockReset();
  postDriverPositionSpy.mockResolvedValue({ ok: true });
  reporter.__resetForTests();
});
afterEach(() => {
  reporter.__resetForTests();
  vi.useRealTimers();
});

describe('driver-position-reporter — un solo watcher por sesión', () => {
  it('start dos veces con la misma asignación abre UN watchPosition', () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    reporter.start('asg-1');
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(reporter.getSnapshot().isWatching).toBe(true);
  });
  it('start con OTRA asignación cierra el watcher anterior y abre uno nuevo', () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    reporter.start('asg-2');
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
    expect(reporter.getSnapshot().assignmentId).toBe('asg-2');
  });
  it('stop cierra el watcher y deja isWatching=false', () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    reporter.stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(reporter.getSnapshot().isWatching).toBe(false);
  });
});

describe('driver-position-reporter — permiso denegado', () => {
  // Visto en el preview: con el permiso negado la tarjeta decía «Reportando
  // posición en vivo» con 0 puntos. Sin permiso no hay observación: hay que
  // decirlo y dejar el botón «Reintentar» a la vista.
  it('PERMISSION_DENIED deja de observar y explica qué hacer', () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    const onError = geo.watchPosition.mock.calls[0]?.[1] as (e: GeolocationPositionError) => void;
    onError({
      code: 1,
      message: 'User denied Geolocation',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);
    expect(reporter.getSnapshot().isWatching).toBe(false);
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    expect(reporter.getSnapshot().lastError).toMatch(/permiso de ubicación/i);
    // Y se puede volver a intentar: start abre un watcher nuevo.
    reporter.start('asg-1');
    expect(geo.watchPosition).toHaveBeenCalledTimes(2);
  });
  it('un error transitorio (TIMEOUT) no detiene la observación', () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    const onError = geo.watchPosition.mock.calls[0]?.[1] as (e: GeolocationPositionError) => void;
    onError({
      code: 3,
      message: 'Timeout expired',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError);
    expect(reporter.getSnapshot().isWatching).toBe(true);
    expect(geo.clearWatch).not.toHaveBeenCalled();
  });
});

describe('driver-position-reporter — throttle y latido', () => {
  it('3 fixes en 2 s y 3 m → un solo POST', async () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    geo.emit(-33.400009, -70.6, T0 + 1_000);
    geo.emit(-33.400018, -70.6, T0 + 2_000);
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(1);
    expect(reporter.getSnapshot().pointsSent).toBe(1);
  });
  it('sin fix en 25 s pide getCurrentPosition y envía el latido aunque no se haya movido', async () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    const cb = geo.getCurrentPosition.mock.calls[0]?.[0] as (p: GeolocationPosition) => void;
    cb(geo.pos(-33.4, -70.6, T0 + 25_000));
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(2);
  });
});

describe('driver-position-reporter — cola offline con reintento', () => {
  it('POST fallido → el punto queda en cola persistida; al volver online se drena', async () => {
    const geo = fakeGeo();
    postDriverPositionSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    await flushMicrotasks();
    expect(reporter.getSnapshot().queued).toBe(1);
    expect(reporter.getSnapshot().pointsSent).toBe(0);
    expect(localStorage.getItem('booster.posiciones.asg-1')).toContain(new Date(T0).toISOString());
    postDriverPositionSpy.mockResolvedValue({ ok: true });
    window.dispatchEvent(new Event('online'));
    await flushMicrotasks();
    expect(reporter.getSnapshot().queued).toBe(0);
    expect(reporter.getSnapshot().pointsSent).toBe(1);
    // El punto reenviado conserva su timestamp_device original (cobertura).
    expect(postDriverPositionSpy).toHaveBeenLastCalledWith(
      'asg-1',
      expect.objectContaining({ timestamp_device: new Date(T0).toISOString() }),
    );
  });
  it('mientras observa, drena cada 20 s lo pendiente', async () => {
    const geo = fakeGeo();
    postDriverPositionSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    await flushMicrotasks();
    expect(reporter.getSnapshot().queued).toBe(1);
    postDriverPositionSpy.mockResolvedValue({ ok: true });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(reporter.getSnapshot().queued).toBe(0);
  });
  it('flush() drena y resuelve con el conteo', async () => {
    const geo = fakeGeo();
    postDriverPositionSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    await flushMicrotasks();
    postDriverPositionSpy.mockResolvedValue({ ok: true });
    const r = await reporter.flush();
    expect(r).toEqual({ enviados: 1, restantes: 0 });
  });
  it('409 assignment_not_active vacía la cola sin marcar error', async () => {
    const geo = fakeGeo();
    postDriverPositionSpy.mockRejectedValue(
      Object.assign(new Error('409'), { status: 409, code: 'assignment_not_active' }),
    );
    reporter.start('asg-1');
    geo.emit(-33.4, -70.6, T0);
    await flushMicrotasks();
    expect(reporter.getSnapshot().queued).toBe(0);
  });

  // BOO-KJHITL: cabeza grosera persistida + puntos Valparaíso detrás.
  it('una cabeza con accuracy rechazada no deja la cola ni «Sin señal»', async () => {
    localStorage.setItem(
      'booster.posiciones.asg-1',
      JSON.stringify([
        {
          timestamp_device: new Date(T0).toISOString(),
          latitude: 39.95,
          longitude: -75.3,
          accuracy_m: 4_700_000,
        },
        {
          timestamp_device: new Date(T0 + 15_000).toISOString(),
          latitude: -33.047,
          longitude: -71.613,
          accuracy_m: 12,
        },
        {
          timestamp_device: new Date(T0 + 30_000).toISOString(),
          latitude: -33.048,
          longitude: -71.614,
          accuracy_m: 8,
        },
      ]),
    );
    fakeGeo();
    reporter.start('asg-1');
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(2);
    expect(postDriverPositionSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ latitude: -33.047, accuracy_m: 12 }),
    );
    expect(reporter.getSnapshot().queued).toBe(0);
    expect(reporter.getSnapshot().pointsSent).toBe(2);
    expect(reporter.getSnapshot().lastError).toBeNull();
  });

  it('400 del API en un punto válido no bloquea el siguiente ni marca Sin señal', async () => {
    const geo = fakeGeo();
    postDriverPositionSpy.mockRejectedValueOnce(
      Object.assign(new Error('validation'), { status: 400 }),
    );
    reporter.start('asg-1');
    geo.emit(-33.047, -71.613, T0);
    await flushMicrotasks();
    geo.emit(-33.048, -71.614, T0 + 15_000);
    await flushMicrotasks();
    expect(reporter.getSnapshot().queued).toBe(0);
    expect(reporter.getSnapshot().pointsSent).toBe(1);
    expect(reporter.getSnapshot().lastError).toBeNull();
    expect(postDriverPositionSpy).toHaveBeenLastCalledWith(
      'asg-1',
      expect.objectContaining({ latitude: -33.048 }),
    );
  });

  it('un fix grosero en vivo no se encola y el siguiente válido sí se envía', async () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    geo.emit(39.95, -75.3, T0, 4_700_000);
    await flushMicrotasks();
    expect(postDriverPositionSpy).not.toHaveBeenCalled();
    expect(reporter.getSnapshot().queued).toBe(0);
    geo.emit(-33.047, -71.613, T0 + 5_000);
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(1);
    expect(postDriverPositionSpy).toHaveBeenCalledWith(
      'asg-1',
      expect.objectContaining({ latitude: -33.047, accuracy_m: 8 }),
    );
    expect(reporter.getSnapshot().pointsSent).toBe(1);
  });

  // Playwright setGeolocation usa accuracy 0. El API rechaza 0 (Zod positive);
  // hay que POSTear con accuracy_m null para que el e2e conductor vea el POST.
  it('un fix con accuracy 0 se POSTea con accuracy_m null', async () => {
    const geo = fakeGeo();
    reporter.start('asg-1');
    geo.emit(-33.4372, -70.6506, T0, 0);
    await flushMicrotasks();
    expect(postDriverPositionSpy).toHaveBeenCalledTimes(1);
    expect(postDriverPositionSpy).toHaveBeenCalledWith(
      'asg-1',
      expect.objectContaining({ latitude: -33.4372, longitude: -70.6506, accuracy_m: null }),
    );
    expect(reporter.getSnapshot().queued).toBe(0);
    expect(reporter.getSnapshot().pointsSent).toBe(1);
  });
});
