import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Tests de useImpersonation — lee el custom claim `impersonated_by` del ID
 * token (patrón de useIsDemo). El backend #584 lo emite sobre el UID del
 * target; la presencia del claim = sesión impersonada.
 */

const useAuthMock = vi.fn();
vi.mock('./use-auth.js', () => ({
  useAuth: () => useAuthMock(),
}));

const { useImpersonation } = await import('./use-impersonation.js');

function mockUser(claims: Record<string, unknown>) {
  return {
    getIdTokenResult: vi.fn().mockResolvedValue({ claims }),
  };
}

describe('useImpersonation', () => {
  it('loading → active null', () => {
    useAuthMock.mockReturnValue({ user: undefined, loading: true });
    const { result } = renderHook(() => useImpersonation());
    expect(result.current.active).toBeNull();
  });

  it('no logueado → active false', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    const { result } = renderHook(() => useImpersonation());
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(result.current.impersonatedBy).toBeNull();
  });

  it('sesión con claim impersonated_by → active true + impersonatedBy', async () => {
    useAuthMock.mockReturnValue({
      user: mockUser({ impersonated_by: 'admin-uuid' }),
      loading: false,
    });
    const { result } = renderHook(() => useImpersonation());
    await waitFor(() => expect(result.current.active).toBe(true));
    expect(result.current.impersonatedBy).toBe('admin-uuid');
  });

  it('sesión normal sin claim → active false', async () => {
    useAuthMock.mockReturnValue({ user: mockUser({}), loading: false });
    const { result } = renderHook(() => useImpersonation());
    await waitFor(() => expect(result.current.active).toBe(false));
    expect(result.current.impersonatedBy).toBeNull();
  });
});
