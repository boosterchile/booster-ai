import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
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
    expect(getSpy).toHaveBeenCalledWith(`/public/tracking/${VALID_TOKEN}`);
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
