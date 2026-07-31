import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, getActiveEmpresaId } from '../lib/api-client.js';

// El alta termina logueando a la persona con el custom token del backend.
const signInWithCustomTokenMock = vi.fn(async (_token: string) => undefined);
vi.mock('../lib/firebase.js', () => ({ firebaseAuth: {} }));
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: (_auth: unknown, token: string) => signInWithCustomTokenMock(token),
}));
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

// ---------------------------------------------------------------------------
// alta-cliente-autocontenida SC1 — entrar sin pasar por ninguna pantalla de login
// ---------------------------------------------------------------------------
describe('useOnboardingAdminMutation — sesión al terminar el alta', () => {
  it('firma con el custom_token que devuelve el backend', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      user: { id: 'u1' },
      empresa: { id: 'e1' },
      membership: { id: 'm1' },
      custom_token: 'ct-123',
    } as never);

    const { result } = renderHook(() => useOnboardingAdminMutation('tok'), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT as never);
    });

    await waitFor(() => expect(signInWithCustomTokenMock).toHaveBeenCalledWith('ct-123'));
  });

  it('sin custom_token no intenta firmar — el alta igual quedó hecha', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      user: { id: 'u1' },
      empresa: { id: 'e1' },
      membership: { id: 'm1' },
    } as never);

    const { result } = renderHook(() => useOnboardingAdminMutation('tok'), {
      wrapper: makeWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync(VALID_INPUT as never);
    });

    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
    // El alta sí ocurrió: la empresa activa quedó seteada.
    expect(getActiveEmpresaId()).toBe('e1');
  });
});
