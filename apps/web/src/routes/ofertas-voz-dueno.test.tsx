import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import type { OfferPayload } from '../hooks/use-offers.js';
import { api } from '../lib/api-client.js';

const useOffersMineMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/use-offers.js', async () => {
  const actual =
    await vi.importActual<typeof import('../hooks/use-offers.js')>('../hooks/use-offers.js');
  return {
    ...actual,
    useOffersMine: (opts: { enabled?: boolean }) => useOffersMineMock(opts),
  };
});

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => '/app/ofertas',
  useNavigate: () => navigateMock,
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(),
}));

const { OfertasRoute } = await import('./ofertas.js');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Role = NonNullable<MeOnboarded['active_membership']>['role'];
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };

let providedContext: Ctx = { kind: 'unmanaged' };

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OfertasRoute />
    </QueryClientProvider>,
  );
}

function makeMe(over: { role: Role; tieneFichaConductor?: boolean; email: string }): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'user-test',
      email: over.email,
      full_name: 'Usuario Sintético',
      phone: null,
      whatsapp_e164: null,
      rut: '11.111.111-1',
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [],
    active_membership: {
      id: 'm-test',
      role: over.role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'empresa-test',
        legal_name: 'Transportes Ejemplo SpA',
        rut: '11.111.111-1',
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    },
    ...(over.tieneFichaConductor === undefined
      ? {}
      : { tiene_ficha_conductor: over.tieneFichaConductor }),
  };
}

function ofertaPendiente(id: string): OfferPayload {
  return {
    id,
    status: 'pendiente',
    score: 0.5,
    proposed_price_clp: 100_000,
    suggested_vehicle_id: null,
    sent_at: '2026-10-20T12:00:00Z',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    responded_at: null,
    rejection_reason: null,
    trip_request: {
      id: `tr-${id}`,
      tracking_code: 'BOO-TEST01',
      status: 'pendiente',
      origin_address_raw: 'Origen sintético 100',
      origin_region_code: 'XIII',
      destination_address_raw: 'Destino sintético 200',
      destination_region_code: 'V',
      cargo_type: 'carga_seca',
      cargo_weight_kg: 1000,
      pickup_window_start: null,
      pickup_window_end: null,
    },
  };
}

function conOfertas(offers: OfferPayload[]) {
  useOffersMineMock.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { offers },
    refetch: vi.fn(),
    isFetching: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});

describe('Ofertas — tarjeta Aceptar por voz', () => {
  it('dueño con ficha de conductor ve la tarjeta y sigue viendo Aceptar', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({
        role: 'dueno',
        tieneFichaConductor: true,
        email: 'dueno@example.com',
      }),
    };
    conOfertas([ofertaPendiente('o-test')]);
    renderPage();
    expect(screen.getByTestId('voice-accept-control')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceptar oferta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
  });

  it('dueño sin ficha no ve la tarjeta y sí ve Aceptar', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({
        role: 'dueno',
        tieneFichaConductor: false,
        email: 'dueno@example.com',
      }),
    };
    conOfertas([ofertaPendiente('o-test')]);
    renderPage();
    expect(screen.queryByTestId('voice-accept-control')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aceptar oferta/ })).toBeInTheDocument();
  });

  it('conductor empleado con ficha no ve la tarjeta ni Aceptar', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({
        role: 'conductor',
        tieneFichaConductor: true,
        email: 'conductor@example.com',
      }),
    };
    conOfertas([ofertaPendiente('o-test')]);
    renderPage();
    expect(screen.queryByTestId('voice-accept-control')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceptar oferta/ })).not.toBeInTheDocument();
  });

  it('admin ve y usa el botón Aceptar, pero no la tarjeta de voz', async () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({
        role: 'admin',
        tieneFichaConductor: true,
        email: 'admin@example.com',
      }),
    };
    conOfertas([ofertaPendiente('o-test')]);
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      offer: { id: 'o-test', status: 'aceptada', responded_at: '2026-10-20T13:00:00Z' },
      assignment: {
        id: 'asig-test',
        trip_request_id: 'tr-o-test',
        status: 'asignado',
        agreed_price_clp: 100_000,
        accepted_at: '2026-10-20T13:00:00Z',
      },
      superseded_offer_ids: [],
    });
    renderPage();
    expect(screen.queryByTestId('voice-accept-control')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rechazar/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Aceptar oferta/ }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/offers/o-test/accept', {}));
  });
});
