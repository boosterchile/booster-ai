import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../components/map/FleetMap.js', () => ({
  FleetMap: ({ vehicles }: { vehicles: Array<{ id: string; plate: string }> }) => (
    <div data-testid="fleet-map" data-count={vehicles.length}>
      {vehicles.map((v) => (
        <div key={v.id} data-marker-plate={v.plate} />
      ))}
    </div>
  ),
}));

const { FlotaRoute } = await import('./flota.js');

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
        legal_name: 'Transportes Demo',
        rut: '76.123.456-7',
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

describe('FlotaRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<FlotaRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('lista vacía → empty state con CTA "Agregar vehículo"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ fleet: [] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<FlotaRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes vehículos/)).toBeInTheDocument());
    expect(screen.getByText('Agregar vehículo')).toBeInTheDocument();
  });

  it('flota con posiciones → renderiza mapa con N markers + lista lateral', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      fleet: [
        {
          id: 'v1',
          plate: 'BCDF12',
          type: 'camion_pequeno',
          teltonika_imei: '1234567890',
          status: 'activo',
          position: {
            timestamp_device: '2026-05-10T22:00:00Z',
            latitude: -33.45,
            longitude: -70.65,
            speed_kmh: 42,
            angle_deg: 180,
          },
        },
        {
          id: 'v2',
          plate: 'AAAA11',
          type: 'furgon_mediano',
          teltonika_imei: null,
          status: 'activo',
          position: null,
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<FlotaRoute />);
    await waitFor(() => expect(screen.getByTestId('fleet-map')).toBeInTheDocument());
    // Mapa solo muestra vehículos con posición (1 de 2).
    expect(screen.getByTestId('fleet-map')).toHaveAttribute('data-count', '1');
    // Pero la lista lateral muestra los 2.
    expect(screen.getByLabelText(/Patente BC·DF·12/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Patente AA·AA·11/)).toBeInTheDocument();
  });

  it('badges de "reportando" y "sin posición" reflejan el split', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      fleet: [
        {
          id: 'v1',
          plate: 'BCDF12',
          type: 'camion_pequeno',
          teltonika_imei: '1234567890',
          status: 'activo',
          position: {
            timestamp_device: '2026-05-10T22:00:00Z',
            latitude: -33.45,
            longitude: -70.65,
            speed_kmh: 42,
            angle_deg: null,
          },
        },
        {
          id: 'v2',
          plate: 'AAAA11',
          type: 'furgon_mediano',
          teltonika_imei: null,
          status: 'activo',
          position: null,
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<FlotaRoute />);
    await waitFor(() => expect(screen.getByText(/1 reportando/)).toBeInTheDocument());
    expect(screen.getByText(/1 sin posición/)).toBeInTheDocument();
  });

  it('click en card lateral selecciona ese vehículo', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      fleet: [
        {
          id: 'v1',
          plate: 'BCDF12',
          type: 'camion_pequeno',
          teltonika_imei: '1234567890',
          status: 'activo',
          position: {
            timestamp_device: '2026-05-10T22:00:00Z',
            latitude: -33.45,
            longitude: -70.65,
            speed_kmh: 42,
            angle_deg: null,
          },
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<FlotaRoute />);
    await waitFor(() => expect(screen.getByTestId('fleet-map')).toBeInTheDocument());
    // El primer botón clickeable visible debería ser la card del vehículo.
    const cardButtons = screen.getAllByRole('button');
    const cardButton = cardButtons.find((b) => b.textContent?.includes('km/h'));
    expect(cardButton).toBeTruthy();
    if (cardButton) {
      await userEvent.click(cardButton);
      // Después del click, esa card tiene ring-2 (clase de selección).
      expect(cardButton.className).toContain('ring-2');
    }
  });

  it('vehículo sin GPS muestra "sin GPS" en la card', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      fleet: [
        {
          id: 'v1',
          plate: 'BCDF12',
          type: 'camion_pequeno',
          teltonika_imei: null,
          status: 'activo',
          position: null,
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<FlotaRoute />);
    await waitFor(() => expect(screen.getByLabelText(/Patente BC·DF·12/)).toBeInTheDocument());
    expect(screen.getByText('sin GPS')).toBeInTheDocument();
    expect(screen.getByText('Sin device')).toBeInTheDocument();
  });
});
