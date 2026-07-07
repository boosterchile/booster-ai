import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeNeedsOnboarding = Extract<MeResponse, { needs_onboarding: true }>;
type ProtectedContext =
  | { kind: 'onboarded'; me: Extract<MeResponse, { needs_onboarding: false }> }
  | { kind: 'pre-onboarding'; me: MeNeedsOnboarding }
  | { kind: 'unmanaged' };

let providedContext: ProtectedContext = { kind: 'unmanaged' };
const protectedRouteSpy = vi.fn();

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({
    children,
    meRequirement,
  }: {
    children: (ctx: ProtectedContext) => ReactNode;
    meRequirement?: string;
  }) => {
    protectedRouteSpy(meRequirement);
    return <>{children(providedContext)}</>;
  },
}));

const navigateMock = vi.fn();
const useSearchMock = vi.fn(() => ({}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

const { OnboardingAdminRoute } = await import('./onboarding-admin.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeMe(overrides: Partial<MeNeedsOnboarding['firebase']> = {}): MeNeedsOnboarding {
  return {
    needs_onboarding: true,
    firebase: {
      uid: 'fb-uid',
      email: 'felipe@boosterchile.com',
      name: 'Felipe Vicencio',
      picture: undefined,
      email_verified: true,
      ...overrides,
    },
  };
}

async function fillFullForm() {
  fireEvent.change(screen.getByLabelText(/Nombre completo/), {
    target: { value: 'Felipe Vicencio' },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono móvil/), { target: { value: '+56912345678' } });
  fireEvent.change(screen.getByLabelText(/^WhatsApp/), { target: { value: '+56912345678' } });
  fireEvent.change(screen.getByLabelText(/^RUT/), { target: { value: '11.111.111-1' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText('Tu empresa');

  fireEvent.change(screen.getByLabelText(/Razón social/), { target: { value: 'Booster SpA' } });
  fireEvent.change(screen.getByLabelText(/RUT empresa/), { target: { value: '76.123.456-0' } });
  fireEvent.change(screen.getByLabelText(/Email de contacto/), {
    target: { value: 'contacto@booster.cl' },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono de contacto/), {
    target: { value: '+56912345678' },
  });
  fireEvent.change(screen.getByLabelText(/^Dirección/), {
    target: { value: 'Av. Apoquindo 4500' },
  });
  fireEvent.change(screen.getByLabelText(/^Comuna/), { target: { value: 'Las Condes' } });
  fireEvent.change(screen.getByLabelText(/^Ciudad/), { target: { value: 'Santiago' } });
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText(/¿Cómo opera tu empresa?/);

  fireEvent.click(screen.getByRole('button', { name: /Generador de carga/ }));
  fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
  await screen.findByText(/Resumen/);
}

beforeEach(() => {
  vi.clearAllMocks();
  useSearchMock.mockReturnValue({});
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('OnboardingAdminRoute — sin token', () => {
  it('sin ?token= → mensaje de error inmediato, NO monta ProtectedRoute ni llama al API', () => {
    const postSpy = vi.spyOn(api, 'post');
    render(<OnboardingAdminRoute />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(protectedRouteSpy).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('link a /solicitar-acceso para pedir un enlace nuevo', () => {
    render(<OnboardingAdminRoute />);
    const link = screen.getByTestId('onboarding-admin-link-solicitar-acceso');
    expect(link).toHaveAttribute('href', '/solicitar-acceso');
  });
});

describe('OnboardingAdminRoute — con token, contexto pre-onboarding', () => {
  beforeEach(() => {
    useSearchMock.mockReturnValue({ token: 'tok-abc123' });
    providedContext = { kind: 'pre-onboarding', me: makeMe() };
  });

  it('pasa meRequirement="allow-pre-onboarding" a ProtectedRoute y renderiza bienvenida + form', () => {
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    expect(protectedRouteSpy).toHaveBeenCalledWith('allow-pre-onboarding');
    expect(screen.getByText(/Bienvenido, Felipe/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeInTheDocument();
  });

  it('POST incluye el header x-onboarding-token con el token leído de la URL', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-1' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    await fillFullForm();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/empresas/onboarding-admin', expect.any(Object), {
        headers: { 'x-onboarding-token': 'tok-abc123' },
      }),
    );
  });

  it('201 → mismo post-éxito que el flujo viejo (navega a /app)', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      user: { id: 'u' },
      empresa: { id: 'emp-1' },
      membership: { id: 'm', role: 'dueno', status: 'activa' },
    });
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    await fillFullForm();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });

  it('403 onboarding_token_invalid → mensaje genérico único (anti-oráculo SEC-001)', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(403, 'onboarding_token_invalid', null),
    );
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    await fillFullForm();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/enlace ya no es válido/);
  });

  it('409 rut_already_registered → mensaje específico por código', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(409, 'rut_already_registered', null));
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    await fillFullForm();
    fireEvent.click(screen.getByRole('button', { name: /Crear empresa/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/RUT empresa ya está registrado/);
  });
});

describe('OnboardingAdminRoute — contexto no pre-onboarding', () => {
  it('con token pero kind="unmanaged" → no renderiza el form', () => {
    useSearchMock.mockReturnValue({ token: 'tok-abc123' });
    providedContext = { kind: 'unmanaged' };
    render(<OnboardingAdminRoute />, { wrapper: makeWrapper() });
    expect(screen.queryByRole('button', { name: /Crear empresa/ })).not.toBeInTheDocument();
  });
});
