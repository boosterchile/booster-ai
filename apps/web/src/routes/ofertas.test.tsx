import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

const useOffersMineMock = vi.fn();
vi.mock('../hooks/use-offers.js', () => ({
  useOffersMine: useOffersMineMock,
}));

const signOutUserMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: signOutUserMock,
}));

vi.mock('../components/offers/OfferCard.js', () => ({
  OfferCard: (props: { offer: { id: string } }) => (
    <div data-testid="offer-card" data-id={props.offer.id} />
  ),
}));

vi.mock('../components/EmptyState.js', () => ({
  EmptyState: (props: { title: string }) => <div data-testid="empty-state">{props.title}</div>,
}));

const { OfertasRoute } = await import('./ofertas.js');

function makeMe(isTransportista: boolean): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Felipe', email: 'a@b.cl' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: 'dueno',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e1',
        legal_name: 'Booster SpA',
        rut: '76',
        is_generador_carga: false,
        is_transportista: isTransportista,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OfertasRoute', () => {
  it('contexto no onboarded → no renderiza', () => {
    const { container } = render(<OfertasRoute />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('empresa no transportista → warning', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    useOffersMineMock.mockReturnValue({ isLoading: false, isError: false, data: undefined });
    render(<OfertasRoute />);
    expect(screen.getByText(/no opera como carrier/)).toBeInTheDocument();
  });

  it('carrier + loading → "Cargando ofertas"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<OfertasRoute />);
    expect(screen.getByText(/Cargando ofertas/)).toBeInTheDocument();
  });

  it('carrier + error → mensaje de error', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<OfertasRoute />);
    expect(screen.getByText(/No pudimos cargar las ofertas/)).toBeInTheDocument();
  });

  it('carrier + offers vacías → EmptyState', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [] },
      refetch: vi.fn(),
      isFetching: false,
    });
    render(<OfertasRoute />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('carrier + offers presentes → renderiza OfferCard por cada uno', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        offers: [
          { id: 'o1', status: 'pendiente' },
          { id: 'o2', status: 'pendiente' },
        ],
      },
      refetch: vi.fn(),
      isFetching: false,
    });
    render(<OfertasRoute />);
    expect(screen.getAllByTestId('offer-card')).toHaveLength(2);
  });

  it('click Actualizar → refetch', () => {
    const refetch = vi.fn();
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [] },
      refetch,
      isFetching: false,
    });
    render(<OfertasRoute />);
    screen.getByRole('button', { name: /Actualizar/ }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it('isFetching=true → botón muestra "Actualizando"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [] },
      refetch: vi.fn(),
      isFetching: true,
    });
    render(<OfertasRoute />);
    expect(screen.getByRole('button', { name: /Actualizando/ })).toBeDisabled();
  });

  it('click Salir → signOutUser', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    useOffersMineMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { offers: [] },
      refetch: vi.fn(),
      isFetching: false,
    });
    render(<OfertasRoute />);
    screen.getByRole('button', { name: /Salir/ }).click();
    expect(signOutUserMock).toHaveBeenCalled();
  });
});
