import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import { useAcceptTermsV2Mutation, useConsentTermsV2 } from './use-consent-terms-v2.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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

describe('useConsentTermsV2', () => {
  it('accepted=true → reportado tras fetch', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: true,
      accepted_at: '2026-05-10T12:00:00Z',
    });
    const { result } = renderHook(() => useConsentTermsV2(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accepted).toBe(true);
  });

  it('accepted=false reason=pending → carrier sin consent', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ accepted: false, reason: 'pending' });
    const { result } = renderHook(() => useConsentTermsV2(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accepted).toBe(false);
    expect(result.current.data?.reason).toBe('pending');
  });

  it('reason=not_a_carrier → accepted true (no aplica)', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: true,
      reason: 'not_a_carrier',
    });
    const { result } = renderHook(() => useConsentTermsV2(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accepted).toBe(true);
    expect(result.current.data?.reason).toBe('not_a_carrier');
  });

  it('enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({ accepted: false });
    renderHook(() => useConsentTermsV2({ enabled: false }), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useAcceptTermsV2Mutation', () => {
  it('mutate → POST /me/consent/terms-v2 con body vacío', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      ok: true,
      accepted_at: '2026-05-10T12:00:00Z',
      already_accepted: false,
    });
    const { result } = renderHook(() => useAcceptTermsV2Mutation(), { wrapper: makeWrapper() });
    let response: { already_accepted: boolean } | undefined;
    await act(async () => {
      response = (await result.current.mutateAsync()) as { already_accepted: boolean };
    });
    expect(spy).toHaveBeenCalledWith('/me/consent/terms-v2', {});
    expect(response?.already_accepted).toBe(false);
  });

  it('already_accepted=true → respuesta idempotente reportada', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      ok: true,
      accepted_at: '2026-05-01T10:00:00Z',
      already_accepted: true,
    });
    const { result } = renderHook(() => useAcceptTermsV2Mutation(), { wrapper: makeWrapper() });
    let response: { already_accepted: boolean } | undefined;
    await act(async () => {
      response = (await result.current.mutateAsync()) as { already_accepted: boolean };
    });
    expect(response?.already_accepted).toBe(true);
  });
});
