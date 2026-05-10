import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { useBehaviorScore, useCoaching } from './use-behavior-score.js';

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

describe('useCoaching', () => {
  it('default enabled=true → fetch /assignments/:id/coaching', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_id: 't1',
      message: 'Buen trabajo',
      focus: 'felicitacion',
      source: 'gemini',
      model: 'gemini-pro',
      generated_at: '2026-05-10T00:00:00Z',
      status: 'disponible',
    });
    const { result } = renderHook(() => useCoaching('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/assignments/a1/coaching');
  });

  it('enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({});
    renderHook(() => useCoaching('a1', { enabled: false }), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ApiError 401 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    const { result } = renderHook(() => useCoaching('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 403 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden', null));
    const { result } = renderHook(() => useCoaching('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 404 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'not_found', null));
    const { result } = renderHook(() => useCoaching('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('status=no_disponible se devuelve sin error', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_id: 't1',
      message: null,
      focus: null,
      source: null,
      status: 'no_disponible',
      reason: 'pending generation',
    });
    const { result } = renderHook(() => useCoaching('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('no_disponible');
  });
});

describe('useBehaviorScore', () => {
  it('default enabled=true → fetch /assignments/:id/behavior-score', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_id: 't1',
      score: 85,
      nivel: 'bueno',
      breakdown: {
        aceleracionesBruscas: 1,
        frenadosBruscos: 0,
        curvasBruscas: 1,
        excesosVelocidad: 0,
        penalizacionTotal: 15,
        eventosPorHora: 2,
      },
      calculated_at: '2026-05-10T00:00:00Z',
      status: 'disponible',
    });
    const { result } = renderHook(() => useBehaviorScore('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/assignments/a1/behavior-score');
  });

  it('enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({});
    renderHook(() => useBehaviorScore('a1', { enabled: false }), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ApiError 401 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    const { result } = renderHook(() => useBehaviorScore('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 403 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden', null));
    const { result } = renderHook(() => useBehaviorScore('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 404 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'not_found', null));
    const { result } = renderHook(() => useBehaviorScore('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('status=no_disponible se devuelve sin error', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_id: 't1',
      score: null,
      nivel: null,
      breakdown: null,
      status: 'no_disponible',
      reason: 'sin telemetria',
    });
    const { result } = renderHook(() => useBehaviorScore('a1'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe('no_disponible');
  });
});
