import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
const useMeMock = vi.fn();
const useIsDemoMock = vi.fn();
const NavigateMock = vi.fn(({ to }: { to: string }) => <div data-testid="navigate">{to}</div>);

vi.mock('../hooks/use-auth.js', () => ({ useAuth: useAuthMock }));
vi.mock('../hooks/use-me.js', () => ({ useMe: useMeMock }));
vi.mock('../hooks/use-is-demo.js', () => ({ useIsDemo: useIsDemoMock }));
vi.mock('@tanstack/react-router', () => ({ Navigate: NavigateMock }));

const { ProtectedRoute } = await import('./ProtectedRoute.js');

function makeWrapper() {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useMeMock.mockReturnValue({ data: undefined, isLoading: false, error: null });
  // Default a "no demo" — los tests existentes asumen flujo normal.
  useIsDemoMock.mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProtectedRoute', () => {
  it('authLoading=true → muestra splash "Cargando…"', () => {
    useAuthMock.mockReturnValue({ user: undefined, loading: true });
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('sin user → Navigate a /login', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('navigate').textContent).toBe('/login');
  });

  it('skip + user → renderiza children con kind="unmanaged"', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    render(
      <ProtectedRoute meRequirement="skip">
        {(ctx) => <div data-testid="kind">{ctx.kind}</div>}
      </ProtectedRoute>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('kind').textContent).toBe('unmanaged');
  });

  it('require-onboarded + meLoading → splash', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({ data: undefined, isLoading: true, error: null });
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });

  it('require-onboarded + needs_onboarding=true → Navigate a /onboarding', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({
      data: { needs_onboarding: true, firebase: {} },
      isLoading: false,
      error: null,
    });
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('navigate').textContent).toBe('/onboarding');
  });

  it('require-onboarded + meError → Navigate a /onboarding (preonboarding)', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('user_not_registered'),
    });
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('navigate').textContent).toBe('/onboarding');
  });

  it('require-onboarded + onboarded → renderiza children con kind="onboarded"', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u-uuid' },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    render(<ProtectedRoute>{(ctx) => <div data-testid="kind">{ctx.kind}</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('kind').textContent).toBe('onboarded');
  });

  it('allow-pre-onboarding + onboarded → Navigate a /app (no debería estar en /onboarding)', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u' },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    render(
      <ProtectedRoute meRequirement="allow-pre-onboarding">
        {() => <div>contenido</div>}
      </ProtectedRoute>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('navigate').textContent).toBe('/app');
  });

  it('allow-pre-onboarding + needs_onboarding=true → renderiza con kind="pre-onboarding"', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    useMeMock.mockReturnValue({
      data: { needs_onboarding: true, firebase: { uid: 'u' } },
      isLoading: false,
      error: null,
    });
    render(
      <ProtectedRoute meRequirement="allow-pre-onboarding">
        {(ctx) => <div data-testid="kind">{ctx.kind}</div>}
      </ProtectedRoute>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('kind').textContent).toBe('pre-onboarding');
  });

  it('require-onboarded + sesión demo (is_demo=true) + sin clave_numerica → NO muestra RotarClaveModal', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u-demo' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u-uuid-demo', has_clave_numerica: false },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    useIsDemoMock.mockReturnValue(true);
    render(
      <ProtectedRoute>{() => <div data-testid="children">contenido demo</div>}</ProtectedRoute>,
      {
        wrapper: makeWrapper(),
      },
    );
    // Children renderizado sin modal montado encima.
    expect(screen.getByTestId('children')).toBeInTheDocument();
    expect(screen.queryByText('Crea tu clave numérica')).not.toBeInTheDocument();
  });

  it('allow-pre-onboarding + meError → sintetiza me desde Firebase user', () => {
    useAuthMock.mockReturnValue({
      user: {
        uid: 'fb-uid',
        email: 'a@b.c',
        displayName: 'Felipe',
        photoURL: null,
        emailVerified: true,
      },
      loading: false,
    });
    useMeMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('not registered'),
    });
    render(
      <ProtectedRoute meRequirement="allow-pre-onboarding">
        {(ctx) => <div data-testid="kind">{ctx.kind}</div>}
      </ProtectedRoute>,
      { wrapper: makeWrapper() },
    );
    expect(screen.getByTestId('kind').textContent).toBe('pre-onboarding');
  });
});
