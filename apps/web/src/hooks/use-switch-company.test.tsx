import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveEmpresaId } from '../lib/api-client.js';
import { useSwitchCompany } from './use-switch-company.js';

function makeWrapper(client = new QueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useSwitchCompany', () => {
  it('switchTo setea activeEmpresaId en localStorage', async () => {
    const { result } = renderHook(() => useSwitchCompany(), { wrapper: makeWrapper() });
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      await result.current.switchTo('emp-nueva');
    });
    expect(getActiveEmpresaId()).toBe('emp-nueva');
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it('borra la caché de la empresa anterior y conserva /me para refetchearlo', async () => {
    const client = new QueryClient();
    client.setQueryData(['vehiculos', 'emp-a'], [{ id: 'v-a' }]);
    client.setQueryData(['cargas', 'emp-a'], [{ id: 'c-a' }]);
    client.setQueryData(['me'], { active_membership: { empresa: { id: 'emp-a' } } });
    const { result } = renderHook(() => useSwitchCompany(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.switchTo('emp-b');
    });

    expect(client.getQueryData(['vehiculos', 'emp-a'])).toBeUndefined();
    expect(client.getQueryData(['cargas', 'emp-a'])).toBeUndefined();
    // /me no se borra (evitaría un flash de "sin sesión"), se marca para refetch.
    expect(client.getQueryData(['me'])).toBeDefined();
    expect(client.getQueryState(['me'])?.isInvalidated).toBe(true);
    expect(getActiveEmpresaId()).toBe('emp-b');
  });

  it('no refetchea las claves de la empresa anterior con el header nuevo', async () => {
    const client = new QueryClient();
    const fetchSpy = vi.fn(async () => [{ id: 'v-a' }]);
    client.setQueryData(['vehiculos', 'emp-a'], [{ id: 'v-a' }]);
    client
      .getQueryCache()
      .find({ queryKey: ['vehiculos', 'emp-a'] })
      ?.setOptions({
        queryKey: ['vehiculos', 'emp-a'],
        queryFn: fetchSpy,
      });
    const { result } = renderHook(() => useSwitchCompany(), { wrapper: makeWrapper(client) });

    await act(async () => {
      await result.current.switchTo('emp-b');
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getQueryCache().find({ queryKey: ['vehiculos', 'emp-a'] })).toBeUndefined();
  });
});
