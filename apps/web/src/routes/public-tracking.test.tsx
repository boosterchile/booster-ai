import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RootRoute,
  Route,
  Router,
  RouterProvider,
  createMemoryHistory,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';
import { PublicTrackingRoute, formatAge } from './public-tracking.js';

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

function renderWithRouter(token: string): ReactNode {
  const rootRoute = new RootRoute({ component: () => <PublicTrackingRoute /> });
  const trackingRoute = new Route({
    getParentRoute: () => rootRoute,
    path: '/tracking/$token',
    component: () => <PublicTrackingRoute />,
  });
  const routeTree = rootRoute.addChildren([trackingRoute]);
  const router = new Router({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/tracking/${token}`] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatAge', () => {
  it('<60s → "Xs"', () => {
    expect(formatAge(30)).toBe('30s');
    expect(formatAge(0)).toBe('0s');
    expect(formatAge(59)).toBe('59s');
  });

  it('<60min → "X min"', () => {
    expect(formatAge(60)).toBe('1 min');
    expect(formatAge(120)).toBe('2 min');
    expect(formatAge(3599)).toBe('59 min');
  });

  it('>=60min → "Xh Ymin"', () => {
    expect(formatAge(3600)).toBe('1h');
    expect(formatAge(3661)).toBe('1h 1min');
    expect(formatAge(7200)).toBe('2h');
    expect(formatAge(7320)).toBe('2h 2min');
  });
});

describe('PublicTrackingRoute', () => {
  it('renderiza loading mientras carga', async () => {
    vi.spyOn(api, 'get').mockReturnValue(new Promise(() => undefined));
    render(renderWithRouter(VALID_TOKEN));
    // El router carga async; esperamos al primer render del componente.
    await waitFor(() => expect(screen.getByText(/cargando seguimiento/i)).toBeInTheDocument());
  });

  it('renderiza error not-found para 404', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, 'not_found', { error: 'not_found' }));
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() =>
      expect(screen.getByText(/link de seguimiento no válido/i)).toBeInTheDocument(),
    );
  });

  it('renderiza status + ruta + vehículo + posición cuando hay data', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-XYZ987',
        status: 'en_proceso',
        origin_address: 'Av. Apoquindo 123, Las Condes',
        destination_address: 'Calle Coquimbo 45, La Serena',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: {
        timestamp: '2026-05-10T15:00:00Z',
        latitude: -33.4172,
        longitude: -70.6063,
        speed_kmh: 65,
      },
      eta_minutes: null,
    });
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByText(/^En camino$/)).toBeInTheDocument());
    expect(screen.getByText(/BOO-XYZ987/i)).toBeInTheDocument();
    expect(screen.getByText(/Av\. Apoquindo 123/i)).toBeInTheDocument();
    expect(screen.getByText(/Calle Coquimbo 45/i)).toBeInTheDocument();
    expect(screen.getByText(/Camión 3\/4/i)).toBeInTheDocument();
    expect(screen.getByText(/\*\*\*AS12/i)).toBeInTheDocument();
    expect(screen.getByText(/65 km\/h/i)).toBeInTheDocument();
    // Coordenadas formateadas
    expect(screen.getByText(/-33\.41720/i)).toBeInTheDocument();
  });

  it('NO muestra plate completa en el DOM', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X',
        status: 'asignado',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_pequeno', plate_partial: '***GR99' },
      position: null,
      eta_minutes: null,
    });
    const { container } = render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByText(/asignado/i)).toBeInTheDocument());
    // Defensa: el DOM completo no debe contener "TOPSECRET" ni similar.
    expect(container.textContent).not.toMatch(/[A-Z]{6,}\d/);
  });

  it('posición ausente → muestra mensaje "sin posición reciente"', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X',
        status: 'asignado',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: null,
      eta_minutes: null,
    });
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByText(/sin posición reciente/i)).toBeInTheDocument());
  });

  it('progress disponible → muestra avg_speed + age', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X',
        status: 'en_proceso',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: {
        timestamp: '2026-05-10T15:00:00Z',
        latitude: -33,
        longitude: -70,
        speed_kmh: 60,
      },
      progress: { avg_speed_kmh_last_15min: 67.3, last_position_age_seconds: 90 },
      eta_minutes: null,
    });
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByTestId('progress-card')).toBeInTheDocument());
    expect(screen.getByText(/67 km\/h/i)).toBeInTheDocument();
    expect(screen.getByText(/hace 1 min/i)).toBeInTheDocument();
  });

  it('botón refresh dispara invalidate (visible)', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X',
        status: 'asignado',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: null,
      eta_minutes: null,
    });
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByLabelText(/refrescar/i)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText(/refrescar/i));
    // Después del click, la query se invalida y se vuelve a llamar.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('status entregado → muestra label "Entregado" + check icon', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      status: 'found',
      trip: {
        tracking_code: 'BOO-X',
        status: 'entregado',
        origin_address: 'A',
        destination_address: 'B',
        cargo_type: 'carga_seca',
      },
      vehicle: { type: 'camion_3_4', plate_partial: '***AS12' },
      position: null,
      eta_minutes: null,
    });
    render(renderWithRouter(VALID_TOKEN));
    await waitFor(() => expect(screen.getByText(/^Entregado$/)).toBeInTheDocument());
  });
});
