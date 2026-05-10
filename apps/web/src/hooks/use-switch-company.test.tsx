import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveEmpresaId } from '../lib/api-client.js';
import { useSwitchCompany } from './use-switch-company.js';

function makeWrapper() {
  const client = new QueryClient();
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
});
