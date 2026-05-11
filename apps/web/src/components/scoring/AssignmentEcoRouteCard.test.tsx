import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';

// Mock the EcoRouteMapPreview to avoid mounting Google Maps in tests.
vi.mock('../offers/EcoRouteMapPreview.js', () => ({
  EcoRouteMapPreview: ({ polylineEncoded }: { polylineEncoded: string }) => (
    <div data-testid="map-preview" data-polyline={polylineEncoded}>
      [eco map preview]
    </div>
  ),
}));

const { AssignmentEcoRouteCard } = await import('./AssignmentEcoRouteCard.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const ASSIGNMENT_ID = 'a-1';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssignmentEcoRouteCard', () => {
  it('default collapsed: no body, no fetch', () => {
    const spy = vi.spyOn(api, 'get');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    expect(screen.getByTestId('assignment-eco-route-toggle')).toBeInTheDocument();
    expect(screen.queryByTestId('assignment-eco-route-body')).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('click expand → dispara fetch a /assignments/:id/eco-route', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: 'route_xyz',
      distance_km: 350,
      duration_s: 12_600,
      status: 'ok',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('assignment-eco-route-toggle'));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(`/assignments/${ASSIGNMENT_ID}/eco-route`),
    );
    await waitFor(() => expect(screen.getByTestId('map-preview')).toBeInTheDocument());
    expect(screen.getByTestId('map-preview')).toHaveAttribute('data-polyline', 'route_xyz');
  });

  it('expanded + status=ok muestra distancia y duración', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: 'route_xyz',
      distance_km: 350.7,
      duration_s: 12_600,
      status: 'ok',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('assignment-eco-route-toggle'));
    await waitFor(() => expect(screen.getByText(/351 km/)).toBeInTheDocument());
    expect(screen.getByText(/210 min/)).toBeInTheDocument();
  });

  it('status=no_routes_api_key → mensaje "mapa no disponible"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: null,
      distance_km: null,
      duration_s: null,
      status: 'no_routes_api_key',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('assignment-eco-route-toggle'));
    await waitFor(() =>
      expect(screen.getByText(/no está disponible en este entorno/i)).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('map-preview')).not.toBeInTheDocument();
  });

  it('status=routes_api_failed → mensaje transitorio', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: null,
      distance_km: null,
      duration_s: null,
      status: 'routes_api_failed',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('assignment-eco-route-toggle'));
    await waitFor(() => expect(screen.getByText(/error transitorio/i)).toBeInTheDocument());
  });

  it('status=route_empty → mensaje "verifica las direcciones"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: null,
      distance_km: null,
      duration_s: null,
      status: 'route_empty',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('assignment-eco-route-toggle'));
    await waitFor(() => expect(screen.getByText(/verifica las direcciones/i)).toBeInTheDocument());
  });

  it('toggle collapse-expand mantiene cache (sin re-fetch al re-expandir)', async () => {
    const spy = vi.spyOn(api, 'get').mockResolvedValueOnce({
      polyline_encoded: 'route_xyz',
      distance_km: 100,
      duration_s: 3600,
      status: 'ok',
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <AssignmentEcoRouteCard assignmentId={ASSIGNMENT_ID} />
      </Wrapper>,
    );
    const toggle = screen.getByTestId('assignment-eco-route-toggle');
    fireEvent.click(toggle); // expand
    await waitFor(() => expect(screen.getByTestId('map-preview')).toBeInTheDocument());
    fireEvent.click(toggle); // collapse
    expect(screen.queryByTestId('map-preview')).not.toBeInTheDocument();
    fireEvent.click(toggle); // re-expand
    await waitFor(() => expect(screen.getByTestId('map-preview')).toBeInTheDocument());
    // staleTime 30min → no re-fetch
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
