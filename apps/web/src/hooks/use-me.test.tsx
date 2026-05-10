import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { useMe } from './use-me.js';

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

describe('useMe', () => {
  it('enabled=false → no fetch', () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValue({});
    renderHook(() => useMe({ enabled: false }), { wrapper: makeWrapper() });
    expect(spy).not.toHaveBeenCalled();
  });

  it('enabled=true → fetch /me y devuelve data', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      needs_onboarding: false,
      user: { id: 'u', email: 'a@b.c' },
      memberships: [],
      active_membership: null,
    });
    const { result } = renderHook(() => useMe({ enabled: true }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as { user: { id: string } }).user.id).toBe('u');
  });

  it('ApiError 401 → no retry', async () => {
    const err = new ApiError(401, 'unauthorized', null);
    const spy = vi.spyOn(api, 'get').mockRejectedValue(err);
    const { result } = renderHook(() => useMe({ enabled: true }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('ApiError 404 → no retry', async () => {
    const err = new ApiError(404, 'user_not_registered', null);
    const spy = vi.spyOn(api, 'get').mockRejectedValue(err);
    const { result } = renderHook(() => useMe({ enabled: true }), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
