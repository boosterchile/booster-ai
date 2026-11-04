import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import { useFeatureFlags } from './use-feature-flags.js';

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

describe('useFeatureFlags', () => {
  it('devuelve los flags del backend cuando el endpoint responde', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      auth_universal_v1_activated: true,
      wake_word_voice_activated: false,
      matching_algorithm_v2_activated: true,
    });
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.flags.auth_universal_v1_activated).toBe(true);
    expect(result.current.flags.wake_word_voice_activated).toBe(false);
    expect(result.current.flags.matching_algorithm_v2_activated).toBe(true);
  });

  it('default conservador (todos false) si el endpoint falla', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'));
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    // El hook usa `retry: 1` para resilience. Esperamos hasta 5s para que
    // el retry + fallback al estado de error ocurra (default backoff
    // exponencial inicial es ~1s en react-query v5).
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(result.current.flags.auth_universal_v1_activated).toBe(false);
    expect(result.current.flags.wake_word_voice_activated).toBe(false);
    expect(result.current.flags.matching_algorithm_v2_activated).toBe(false);
  });

  it('loading inicial → flags por defecto (false) sin crash', () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined)); // never resolve
    const Wrapper = makeWrapper();
    const { result } = renderHook(() => useFeatureFlags(), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    // Aun en loading state, debe haber un valor defaultivo seguro.
    expect(result.current.flags.auth_universal_v1_activated).toBe(false);
  });
});
