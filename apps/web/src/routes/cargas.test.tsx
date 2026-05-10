import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

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
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'trip-1' }),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../components/EmptyState.js', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  emptyStateActionClass: 'btn',
}));

vi.mock('../components/map/VehicleMap.js', () => ({
  VehicleMap: () => <div data-testid="vehicle-map" />,
}));

const { CargasListRoute, CargasNuevoRoute, CargasDetalleRoute } = await import('./cargas.js');

function makeMe(isShipper: boolean): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: 'dueno',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'E',
        rut: '76',
        is_generador_carga: isShipper,
        is_transportista: false,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CargasListRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasListRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('no shipper → "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    wrap(<CargasListRoute />);
    expect(screen.getByText(/generador de carga/i)).toBeInTheDocument();
  });

  it('shipper + lista vacía → mensaje "No tienes cargas activas"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ trip_requests: [] });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasListRoute />);
    await waitFor(() => expect(screen.getByText('No tienes cargas activas')).toBeInTheDocument());
  });

  it('shipper + lista con un trip → renderiza tracking code', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_requests: [
        {
          id: 't1',
          tracking_code: 'BST-001',
          status: 'esperando_match',
          origin_address_raw: 'Av X',
          origin_region_code: 'XIII',
          destination_address_raw: 'Av Y',
          destination_region_code: 'V',
          cargo_type: 'carga_seca',
          cargo_weight_kg: 5000,
          cargo_volume_m3: null,
          pickup_window_start: null,
          pickup_window_end: null,
          created_at: '2026-05-10T10:00:00Z',
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasListRoute />);
    await waitFor(() => expect(screen.getAllByText(/BST-001/).length).toBeGreaterThan(0));
  });
});

describe('CargasNuevoRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasNuevoRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('no shipper → "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    wrap(<CargasNuevoRoute />);
    expect(screen.getByText(/Sin permisos|no opera como generador/i)).toBeInTheDocument();
  });

  it('shipper → renderiza Layout con form', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });
});

describe('CargasDetalleRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasDetalleRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + GET ok → renderiza con tracking_code', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 'trip-1',
        tracking_code: 'BST-999',
        status: 'esperando_match',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        cargo_volume_m3: null,
        pickup_window_start: null,
        pickup_window_end: null,
        created_at: '2026-05-10T10:00:00Z',
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(/BST-999/).length).toBeGreaterThan(0));
  });
});
