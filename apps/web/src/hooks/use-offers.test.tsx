import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import {
  useAcceptOfferMutation,
  useEcoPreview,
  useOffersMine,
  useRejectOfferMutation,
} from './use-offers.js';

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

describe('useOffersMine', () => {
  it('default status=pendiente', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ offers: [] });
    const { result } = renderHook(() => useOffersMine(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/offers/mine?status=pendiente');
  });

  it('status custom', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({ offers: [] });
    renderHook(() => useOffersMine({ status: 'aceptada' }), { wrapper: makeWrapper() });
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/offers/mine?status=aceptada'));
  });

  it('enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ offers: [] });
    renderHook(() => useOffersMine({ enabled: false }), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ApiError 401 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    const { result } = renderHook(() => useOffersMine(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 403 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden', null));
    const { result } = renderHook(() => useOffersMine(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('useAcceptOfferMutation', () => {
  it('POST /offers/:id/accept y onSuccess invalida', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      offer: { id: 'o1' },
      assignment: { id: 'a1' },
      superseded_offer_ids: [],
    });
    const { result } = renderHook(() => useAcceptOfferMutation(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ offerId: 'o1' });
    });
    expect(spy).toHaveBeenCalledWith('/offers/o1/accept', {});
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useRejectOfferMutation', () => {
  it('POST sin reason envía body vacío', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      offer: { id: 'o1' },
    });
    const { result } = renderHook(() => useRejectOfferMutation(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ offerId: 'o1' });
    });
    expect(spy).toHaveBeenCalledWith('/offers/o1/reject', {});
  });

  it('POST con reason envía body con reason', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({ offer: { id: 'o1' } });
    const { result } = renderHook(() => useRejectOfferMutation(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ offerId: 'o1', reason: 'fuera de zona' });
    });
    expect(spy).toHaveBeenCalledWith('/offers/o1/reject', { reason: 'fuera de zona' });
  });
});

describe('useEcoPreview', () => {
  it('default enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({});
    renderHook(() => useEcoPreview('o1'), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it('enabled=true → fetch /offers/:id/eco-preview', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request_id: 'tr1',
      distance_km: 100,
      emisiones_kgco2e_wtw: 50,
      data_source: 'routes_api',
    });
    const { result } = renderHook(() => useEcoPreview('o1', { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith('/offers/o1/eco-preview');
  });

  it('ApiError 401 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    const { result } = renderHook(() => useEcoPreview('o1', { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 403 → no retry', async () => {
    const spy = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden', null));
    const { result } = renderHook(() => useEcoPreview('o1', { enabled: true }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
