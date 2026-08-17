import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 9 (medicion-huella-segmento): el reporter expone la última lectura del
 * geofence del origen que devuelve `POST /assignments/:id/driver-position`
 * (evaluado en el API, T8), con el timestamp de la posición que la produjo —
 * ese es el instante del cruce que después viaja como `picked_up_at`.
 */
const postDriverPositionSpy = vi.fn();
vi.mock('../services/driver-position.js', async () => {
  const actual = await vi.importActual<typeof import('../services/driver-position.js')>(
    '../services/driver-position.js',
  );
  return {
    ...actual,
    postDriverPosition: (...args: unknown[]) => postDriverPositionSpy(...args),
  };
});

const { useDriverPositionReporter } = await import('./use-driver-position-reporter.js');

const T1_MS = Date.parse('2026-08-02T09:30:00.000Z');

/** Simula el browser: `watchPosition` guarda el callback y lo dispara a mano. */
function installFakeGeolocation() {
  let success: ((pos: GeolocationPosition) => void) | null = null;
  const watchPosition = vi.fn((cb: (pos: GeolocationPosition) => void) => {
    success = cb;
    return 7;
  });
  const clearWatch = vi.fn();
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch },
    configurable: true,
  });
  return {
    emit(lat: number, lng: number, timestampMs: number) {
      success?.({
        timestamp: timestampMs,
        coords: {
          latitude: lat,
          longitude: lng,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
      } as GeolocationPosition);
    },
    watchPosition,
    clearWatch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDriverPositionReporter — lastGeofence', () => {
  it('arranca en null y toma el veredicto del API con el timestamp de la posición', async () => {
    const geo = installFakeGeolocation();
    postDriverPositionSpy.mockResolvedValue({
      ok: true,
      geofence: { estado: 'dentro', distancia_m: 42 },
    });
    const { result } = renderHook(() => useDriverPositionReporter());
    expect(result.current.lastGeofence).toBeNull();

    act(() => result.current.start('asg-1'));
    act(() => geo.emit(-33.4188917, -70.6045211, T1_MS));

    await waitFor(() => expect(result.current.pointsSent).toBe(1));
    expect(result.current.lastGeofence).toEqual({
      estado: 'dentro',
      distanciaM: 42,
      at: new Date(T1_MS).toISOString(),
    });
  });

  it('respuesta sin geofence (API viejo o degradado): lastGeofence queda null, no rompe', async () => {
    const geo = installFakeGeolocation();
    postDriverPositionSpy.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useDriverPositionReporter());

    act(() => result.current.start('asg-1'));
    act(() => geo.emit(-33.4, -70.6, T1_MS));

    await waitFor(() => expect(result.current.pointsSent).toBe(1));
    expect(result.current.lastGeofence).toBeNull();
    expect(result.current.lastError).toBeNull();
  });

  it('stop() + start() de otro servicio limpia la lectura anterior', async () => {
    const geo = installFakeGeolocation();
    postDriverPositionSpy.mockResolvedValue({
      ok: true,
      geofence: { estado: 'fuera', distancia_m: 900 },
    });
    const { result } = renderHook(() => useDriverPositionReporter());

    act(() => result.current.start('asg-1'));
    act(() => geo.emit(-33.4, -70.6, T1_MS));
    await waitFor(() => expect(result.current.lastGeofence?.estado).toBe('fuera'));

    act(() => result.current.stop());
    act(() => result.current.start('asg-2'));
    expect(result.current.lastGeofence).toBeNull();
  });
});
