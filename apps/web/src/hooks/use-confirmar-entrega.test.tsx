import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { useConfirmarEntregaMutation } from './use-confirmar-entrega.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return {
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
    client,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConfirmarEntregaMutation', () => {
  it('llama PATCH /assignments/:id/confirmar-entrega', async () => {
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: false,
      delivered_at: '2026-05-10T15:30:00Z',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConfirmarEntregaMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ assignmentId: 'a-123' });
    });

    expect(patchSpy).toHaveBeenCalledWith('/assignments/a-123/confirmar-entrega');
  });

  it('expone ok=true + already_delivered=false en el response', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: false,
      delivered_at: '2026-05-10T15:30:00Z',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConfirmarEntregaMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ assignmentId: 'a-1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.already_delivered).toBe(false);
    expect(result.current.data?.delivered_at).toBe('2026-05-10T15:30:00Z');
  });

  it('soporta idempotente: already_delivered=true', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: true,
      delivered_at: '2026-05-10T15:00:00Z',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConfirmarEntregaMutation(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ assignmentId: 'a-1' });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.already_delivered).toBe(true);
  });

  it('propaga ApiError 409 invalid_status', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'invalid_status', { code: 'invalid_status', current_status: 'cancelado' }),
    );
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useConfirmarEntregaMutation(), { wrapper: Wrapper });

    await act(async () => {
      try {
        await result.current.mutateAsync({ assignmentId: 'a-2' });
      } catch {
        // expected
      }
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiError).status).toBe(409);
  });

  it('invalida queries de assignment-detail/score/coaching/offers tras success', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: false,
      delivered_at: '2026-05-10T15:00:00Z',
    });
    const { Wrapper, client } = makeWrapper();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmarEntregaMutation(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.mutateAsync({ assignmentId: 'a-3' });
    });

    const calls = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey?: unknown }).queryKey);
    expect(calls).toContainEqual(['assignment-detail', 'a-3']);
    expect(calls).toContainEqual(['assignment', 'behavior-score', 'a-3']);
    expect(calls).toContainEqual(['assignment', 'coaching', 'a-3']);
    expect(calls).toContainEqual(['offers']);
  });
});
