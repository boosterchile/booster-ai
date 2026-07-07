import {
  Outlet,
  RootRoute,
  Route,
  Router,
  RouterProvider,
  createMemoryHistory,
  useSearch,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * B1 (review final W1, 2026-07-06) — round-trip de `?redirect=` a través de
 * `/login` con el router REAL (memory history, sin mockear
 * useNavigate/useSearch/Navigate/router). Los tests en `login.test.tsx`
 * mockean `@tanstack/react-router` completo — un mock de `navigate` no
 * puede distinguir un no-op de una navegación real, así que nunca hubiera
 * podido atrapar este bug. Solo un router real lo expone.
 *
 * Cadena de falla reproducida acá (la real, no solo la hipótesis de
 * `navigate({to})` como no-op aislado — ver nota de investigación en el
 * reporte de esta tarea): `useAuth()` suscribe a `onAuthStateChanged` de
 * Firebase de forma independiente al `await signInWithEmail(...)` de
 * `submit()`. Nada garantiza que el listener de auth dispare DESPUÉS de
 * que `submit()` alcance su propio `void navigate(...)` — en producción
 * puede disparar antes (o durante el mismo microtask). Si dispara antes,
 * `LoginRoute` re-renderiza con `user` seteado MIENTRAS la URL sigue en
 * `/login?redirect=...`, y el early-return `if (user) return <Navigate
 * to="/app" />` (login.tsx:83, incondicional) gana la carrera y manda a
 * `/app` — perdiendo el `?redirect=` para siempre, sin importar si el
 * `navigate()` manual de más abajo hubiera funcionado.
 *
 * El test fuerza ese orden (el mock de `signInWithEmail` dispara el
 * listener de auth ANTES de resolver, reproduciendo el peor caso) para
 * que el fix de AMBAS líneas (early-return + navigate) sea necesario:
 * arreglar solo el `navigate()` manual no alcanza si la carrera la gana
 * el early-return primero.
 */

const signInWithEmailMock = vi.fn();
type AuthListener = () => void;
let currentUser: { uid: string } | null = null;
const authListeners = new Set<AuthListener>();

function setCurrentUserAndNotify(user: { uid: string } | null) {
  currentUser = user;
  for (const listener of authListeners) {
    listener();
  }
}

vi.mock('../hooks/use-auth.js', () => ({
  useAuth: () => {
    const [, forceTick] = useState(0);
    useEffect(() => {
      const listener = () => forceTick((t) => t + 1);
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    }, []);
    return { user: currentUser, loading: false };
  },
  signInWithGoogle: vi.fn(),
  signInWithEmail: (...args: unknown[]) => signInWithEmailMock(...args),
  signUpWithEmail: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

vi.mock('../hooks/use-feature-flags.js', () => ({
  useFeatureFlags: () => ({
    flags: {
      auth_universal_v1_activated: false,
      wake_word_voice_activated: false,
      matching_algorithm_v2_activated: false,
      demo_mode_activated: false,
    },
    isLoading: false,
    isError: false,
  }),
}));

const { LoginRoute } = await import('./login.js');

function OnboardingAdminStub() {
  const search = (useSearch({ strict: false }) ?? {}) as { token?: string };
  return <div data-testid="onboarding-admin-stub" data-token={search.token ?? ''} />;
}

function AppStub() {
  return <div data-testid="app-stub" />;
}

function buildTestRouter(initialUrl: string) {
  const rootRoute = new RootRoute({ component: () => <Outlet /> });
  const loginRoute = new Route({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginRoute,
  });
  const onboardingAdminRoute = new Route({
    getParentRoute: () => rootRoute,
    path: '/onboarding-admin',
    component: OnboardingAdminStub,
  });
  const appRoute = new Route({
    getParentRoute: () => rootRoute,
    path: '/app',
    component: AppStub,
  });
  const routeTree = rootRoute.addChildren([loginRoute, onboardingAdminRoute, appRoute]);
  return new Router({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialUrl] }),
  });
}

const REDIRECT_TARGET = '/onboarding-admin?token=abc.def';
const LOGIN_WITH_REDIRECT = `/login?redirect=${encodeURIComponent(REDIRECT_TARGET)}`;

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = null;
  authListeners.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('B1 — round-trip de ?redirect= con router real', () => {
  it('sesión ya activa al abrir /login?redirect=... no cae a /app incondicional (login.tsx:83)', async () => {
    // Aísla el early-return: `user` está presente desde el primer render,
    // sin pasar por el form — ej. el aprobado ya tenía sesión Firebase de
    // otra pestaña cuando abrió el link de onboarding.
    currentUser = { uid: 'u1' };

    const router = buildTestRouter(LOGIN_WITH_REDIRECT);
    render(<RouterProvider router={router} />);

    const stub = await screen.findByTestId('onboarding-admin-stub');
    expect(stub).toHaveAttribute('data-token', 'abc.def');
    expect(screen.queryByTestId('app-stub')).not.toBeInTheDocument();
  });

  it('sign-in exitoso donde el listener de auth dispara ANTES del navigate() manual navega igual al redirect (no a /app)', async () => {
    // Reproduce la carrera real: el mock de signInWithEmail dispara el
    // "onAuthStateChanged" (seteando currentUser + notificando) de forma
    // SÍNCRONA antes de resolver su propia promesa — el peor caso posible,
    // donde el re-render con `user` seteado ocurre antes de que `submit()`
    // llegue a su propio `void navigate(...)`.
    signInWithEmailMock.mockImplementation(async () => {
      setCurrentUserAndNotify({ uid: 'u1' });
    });

    const router = buildTestRouter(LOGIN_WITH_REDIRECT);
    render(<RouterProvider router={router} />);

    fireEvent.change(await screen.findByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/ }));

    await waitFor(() => expect(signInWithEmailMock).toHaveBeenCalled());

    const stub = await screen.findByTestId('onboarding-admin-stub');
    expect(stub).toHaveAttribute('data-token', 'abc.def');
    expect(screen.queryByTestId('app-stub')).not.toBeInTheDocument();
  });
});
