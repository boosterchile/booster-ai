import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import { useProfileMutation } from './use-profile-mutation.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe('useProfileMutation', () => {
  it('PATCH /me/profile con input', async () => {
    const spy = vi.spyOn(api, 'patch').mockResolvedValueOnce({
      user: { id: 'u', email: 'a@b.c', full_name: 'Felipe Updated' },
    });
    const { result } = renderHook(() => useProfileMutation(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync({ full_name: 'Felipe Updated' });
    });
    expect(spy).toHaveBeenCalledWith('/me/profile', { full_name: 'Felipe Updated' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
