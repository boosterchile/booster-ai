import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getActiveEmpresaId } from '../lib/api-client.js';
import { useOnboardingMutation } from './use-onboarding-mutation.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Cast a never para evitar drift del schema de shared-schemas en tests del wire.
// El comportamiento testeado es la mutación HTTP, no la validación del input
// (que ya está cubierta en shared-schemas tests).
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

describe('useOnboardingMutation', () => {
  it('POST /empresas/onboarding y onSuccess setea activeEmpresa', async () => {
    const spy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-uuid' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    const { result } = renderHook(() => useOnboardingMutation(), { wrapper: makeWrapper() });
    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT);
    });
    expect(spy).toHaveBeenCalledWith('/empresas/onboarding', VALID_INPUT);
    await waitFor(() => expect(getActiveEmpresaId()).toBe('emp-uuid'));
  });
});
