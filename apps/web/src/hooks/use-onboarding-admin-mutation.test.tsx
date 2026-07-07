import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getActiveEmpresaId } from '../lib/api-client.js';
import { useOnboardingAdminMutation } from './use-onboarding-admin-mutation.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Cast a never — mismo patrón que use-onboarding-mutation.test.tsx: acá se
// testea la mutación HTTP (endpoint + header), no la validación del input
// (cubierta en shared-schemas tests).
const VALID_INPUT = {
  user: {
    full_name: 'Felipe',
    phone: '+56912345678',
    whatsapp_e164: '+56912345678',
  },
  empresa: {
    legal_name: 'Booster',
    rut: '76.000.000-0',
    contact_email: 'a@b.c',
    contact_phone: '+56912345678',
    address: {
      street: 'X',
      number: '1',
      city: 'Stgo',
      commune: 'Stgo Centro',
      region: 'RM',
      country: 'CL',
    },
    is_generador_carga: true,
    is_transportista: false,
  },
  plan_slug: 'gratis',
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useOnboardingAdminMutation', () => {
  it('POST /empresas/onboarding-admin con header x-onboarding-token', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-uuid' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    const { result } = renderHook(() => useOnboardingAdminMutation('token-abc123'), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });
    expect(spy).toHaveBeenCalledWith('/empresas/onboarding-admin', VALID_INPUT, {
      headers: { 'x-onboarding-token': 'token-abc123' },
    });
    await waitFor(() => expect(getActiveEmpresaId()).toBe('emp-uuid'));
  });

  it('token distinto por instancia → header refleja el token vigente', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-uuid-2' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    const { result } = renderHook(() => useOnboardingAdminMutation('otro-token'), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });
    expect(spy).toHaveBeenCalledWith('/empresas/onboarding-admin', VALID_INPUT, {
      headers: { 'x-onboarding-token': 'otro-token' },
    });
  });
});
