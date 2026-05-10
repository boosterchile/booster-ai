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
  useParams: () => ({ id: 'veh-1' }),
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

const { VehiculosListRoute, VehiculosNuevoRoute, VehiculosDetalleRoute } = await import(
  './vehiculos.js'
);

function makeMe(): MeOnboarded {
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
        is_generador_carga: false,
        is_transportista: true,
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

describe('VehiculosListRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosListRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + lista vacía → mensaje "Aún no tienes vehículos"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ vehicles: [] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes vehículos/)).toBeInTheDocument());
  });

  it('onboarded + vehículos → renderiza plate', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicles: [
        {
          id: 'v1',
          plate: 'ABCD12',
          type: 'camion_pequeno',
          capacity_kg: 5000,
          capacity_m3: null,
          year: 2020,
          brand: null,
          model: null,
          fuel_type: 'diesel',
          curb_weight_kg: null,
          consumption_l_per_100km_baseline: null,
          teltonika_imei: null,
          rut: null,
          status: 'activo',
          available_for_assignment: true,
          notes: null,
          created_at: '2026-05-10T10:00:00Z',
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    // formatPlateForDisplay puede insertar espacios/separadores; basta verificar
    // que el dígito de patente quede visible en la página.
    await waitFor(() =>
      expect(
        screen.getAllByText((_t, n) => n?.textContent?.includes('AB·CD·12') ?? false).length,
      ).toBeGreaterThan(0),
    );
  });
});

describe('VehiculosNuevoRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosNuevoRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded → renderiza Layout', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosNuevoRoute />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });
});

describe('VehiculosDetalleRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosDetalleRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + GET ok → renderiza plate del detalle', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return {
          vehicle: {
            id: 'veh-1',
            plate: 'XYZ789',
            type: 'camion_grande',
            capacity_kg: 20000,
            capacity_m3: null,
            year: 2022,
            brand: 'Volvo',
            model: 'FH',
            fuel_type: 'diesel',
            curb_weight_kg: 10000,
            consumption_l_per_100km_baseline: '32.5',
            teltonika_imei: null,
            rut: null,
            status: 'activo',
            available_for_assignment: true,
            notes: null,
            created_at: '2026-05-10T10:00:00Z',
          },
        };
      }
      // Otras queries devolverán null/objetos vacíos.
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() =>
      expect(
        screen.getAllByText((_t, n) => n?.textContent?.includes('XY') ?? false).length,
      ).toBeGreaterThan(0),
    );
  });
});
