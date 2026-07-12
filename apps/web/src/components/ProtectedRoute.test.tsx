import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
const useMeMock = vi.fn();
const useIsDemoMock = vi.fn();
const useImpersonationMock = vi.fn();
const useFeatureFlagsMock = vi.fn();
const NavigateMock = vi.fn(({ to, search }: { to: string; search?: unknown }) => (
  <div data-testid="navigate" data-search={JSON.stringify(search ?? null)}>
    {to}
  </div>
));

vi.mock('../hooks/use-auth.js', () => ({ useAuth: useAuthMock }));
vi.mock('../hooks/use-me.js', () => ({ useMe: useMeMock }));
vi.mock('../hooks/use-is-demo.js', () => ({ useIsDemo: useIsDemoMock }));
vi.mock('../hooks/use-impersonation.js', () => ({ useImpersonation: useImpersonationMock }));
vi.mock('../hooks/use-feature-flags.js', () => ({ useFeatureFlags: useFeatureFlagsMock }));
vi.mock('@tanstack/react-router', () => ({ Navigate: NavigateMock }));

/** Flags con el universal opcionalmente encendido (defaults conservadores). */
function flagsWith(overrides: { auth_universal_v1_activated?: boolean } = {}) {
  return {
    flags: {
      auth_universal_v1_activated: overrides.auth_universal_v1_activated ?? false,
      wake_word_voice_activated: false,
      matching_algorithm_v2_activated: false,
      demo_mode_activated: false,
    },
    isLoading: false,
    isError: false,
  };
}

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
  // Default a "no impersonación" y flag universal apagado — los tests
  // existentes asumen flujo normal sin modal de clave.
  useImpersonationMock.mockReturnValue({ active: false, impersonatedBy: null });
  useFeatureFlagsMock.mockReturnValue(flagsWith());
});

afterEach(() => {
  vi.restoreAllMocks();
  // Algunos tests mutan window.location vía pushState; resetear para no
  // filtrar estado entre tests (jsdom no lo hace solo entre tests del mismo archivo).
  window.history.pushState({}, '', '/');
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

  it('sin user → Navigate a /login preserva path + query actual en search.redirect (W1.3 — onboarding-admin necesita sobrevivir el round-trip de login)', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    window.history.pushState({}, '', '/onboarding-admin?token=abc123');
    render(<ProtectedRoute>{() => <div>contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    const nav = screen.getByTestId('navigate');
    expect(nav.textContent).toBe('/login');
    expect(nav.getAttribute('data-search')).toBe(
      JSON.stringify({ redirect: '/onboarding-admin?token=abc123' }),
    );
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

  it('require-onboarded + usuario real (no demo, no impersonación) + flag universal ON + sin clave → SÍ muestra RotarClaveModal', () => {
    // Control (baseline C3): el modal DEBE seguir montándose y bloqueando a un
    // usuario real que todavía no creó su clave. Prueba que el gate de
    // impersonación no lo esconde a los usuarios legítimos.
    useAuthMock.mockReturnValue({ user: { uid: 'u-real' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u-uuid-real', has_clave_numerica: false },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    useFeatureFlagsMock.mockReturnValue(flagsWith({ auth_universal_v1_activated: true }));
    render(<ProtectedRoute>{() => <div data-testid="children">contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('rotar-clave-modal')).toBeInTheDocument();
    expect(screen.getByText('Crea tu clave numérica')).toBeInTheDocument();
  });

  it('require-onboarded + sesión impersonada (active=true) + flag universal ON + sin clave → NO muestra RotarClaveModal (no atrapa al admin)', () => {
    // C1 (rojo antes del fix): hoy el modal se monta también bajo impersonación
    // y atrapa al admin — el backend 403ea correctamente el POST y no hay
    // escape. El gate debe excluir el modal cuando la sesión es impersonada.
    useAuthMock.mockReturnValue({ user: { uid: 'u-target' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u-uuid-target', has_clave_numerica: false },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    useFeatureFlagsMock.mockReturnValue(flagsWith({ auth_universal_v1_activated: true }));
    useImpersonationMock.mockReturnValue({ active: true, impersonatedBy: 'admin-uuid-1' });
    render(
      <ProtectedRoute>{() => <div data-testid="children">contenido target</div>}</ProtectedRoute>,
      { wrapper: makeWrapper() },
    );
    // El children del target se renderiza, pero SIN el modal de clave encima.
    expect(screen.getByTestId('children')).toBeInTheDocument();
    expect(screen.queryByTestId('rotar-clave-modal')).not.toBeInTheDocument();
    expect(screen.queryByText('Crea tu clave numérica')).not.toBeInTheDocument();
  });

  it('require-onboarded + impersonación aún resolviendo (active=null) + flag ON + sin clave → muestra el modal (no lo esconde por race)', () => {
    // Simetría con el trato de `useIsDemo` null: mientras el claim resuelve,
    // `active` es null y NO se debe esconder el modal a un usuario real por un
    // falso "quizás es impersonación". Solo `active === true` gatea.
    useAuthMock.mockReturnValue({ user: { uid: 'u-real' }, loading: false });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { id: 'u-uuid-real', has_clave_numerica: false },
        memberships: [],
        active_membership: null,
      },
      isLoading: false,
      error: null,
    });
    useFeatureFlagsMock.mockReturnValue(flagsWith({ auth_universal_v1_activated: true }));
    useImpersonationMock.mockReturnValue({ active: null, impersonatedBy: null });
    render(<ProtectedRoute>{() => <div data-testid="children">contenido</div>}</ProtectedRoute>, {
      wrapper: makeWrapper(),
    });
    expect(screen.getByTestId('rotar-clave-modal')).toBeInTheDocument();
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
