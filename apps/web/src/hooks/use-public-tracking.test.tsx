import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { LIVE_TRACKING_FETCH } from '../lib/live-tracking.js';
import { usePublicTracking } from './use-public-tracking.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

describe('usePublicTracking', () => {
  it('llama GET /public/tracking/:token y devuelve la data', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X1',
        status: 'en_proceso',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: null,
      eta_minutes: null,
    });
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSpy).toHaveBeenCalledWith(`/public/tracking/${VALID_TOKEN}`, LIVE_TRACKING_FETCH);
    expect(result.current.data?.trip.tracking_code).toBe('BOO-X1');
  });

  it('disabled cuando enabled=false', () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
    } as unknown);
    const Wrapper = makeWrapper();
    renderHook(() => usePublicTracking(VALID_TOKEN, { enabled: false }), { wrapper: Wrapper });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('disabled cuando token vacío', () => {
    const getSpy = vi.spyOn(api, 'get');
    const Wrapper = makeWrapper();
    renderHook(() => usePublicTracking(''), { wrapper: Wrapper });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('NO retry en 404 (token no existe)', async () => {
    const getSpy = vi
      .spyOn(api, 'get')
      .mockRejectedValue(new ApiError(404, 'not_found', { error: 'not_found' }));
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Una sola llamada (sin retry).
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it('soporta el shape con progress (PR-L2 backwards-compat)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X1',
        status: 'en_proceso',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: null,
      progress: { avg_speed_kmh_last_15min: 65, last_position_age_seconds: 30 },
      eta_minutes: null,
    });
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.progress?.avg_speed_kmh_last_15min).toBe(65);
  });
});

function foundTrip(status: string) {
  return {
    status: 'found' as const,
    trip: {
      tracking_code: 'BOO-83ND2C',
      status,
      origin_address: 'A',
      destination_address: 'B',
      cargo_type: 'carga_seca',
    },
    vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
    position: {
      timestamp: '2026-09-21T19:00:00.000Z',
      latitude: -33.39729,
      longitude: -70.79487,
      speed_kmh: 29.02,
    },
    progress: { avg_speed_kmh_last_15min: 29, last_position_age_seconds: 120 },
    eta_minutes: 114,
  };
}

/**
 * Mismos defaults que `main.tsx`: sin refetch al foco y staleTime 30s.
 * El hook tiene que ganarle a eso, si no el seguimiento se queda con el
 * primer snapshot al volver de segundo plano.
 */
function makeProdWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('usePublicTracking — poll mientras el viaje sigue en curso', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('en_proceso vuelve a pedir la posición dentro de 30s, con la pestaña oculta y sin caché HTTP', async () => {
    vi.useFakeTimers();
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue(foundTrip('en_proceso'));
    const hidden = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    try {
      renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: makeProdWrapper() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith(`/public/tracking/${VALID_TOKEN}`, LIVE_TRACKING_FETCH);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(getSpy.mock.calls.length).toBeGreaterThan(1);
    } finally {
      if (hidden) {
        Object.defineProperty(Document.prototype, 'visibilityState', hidden);
      }
      Reflect.deleteProperty(document, 'visibilityState');
    }
  });

  it('al volver a primer plano pide de nuevo, aunque el cliente global apague el refetch al foco', async () => {
    vi.useFakeTimers();
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue(foundTrip('en_proceso'));
    renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: makeProdWrapper() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(getSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('entregado no vuelve a pedir a los 30s', async () => {
    vi.useFakeTimers();
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue(foundTrip('entregado'));
    renderHook(() => usePublicTracking(VALID_TOKEN), { wrapper: makeProdWrapper() });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    const afterFirst = getSpy.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(getSpy.mock.calls.length).toBe(afterFirst);
  });
});
