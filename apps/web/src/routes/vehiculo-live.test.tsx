import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

type ProtectedContext = { kind: 'onboarded' | 'unmanaged' | 'pre-onboarding' };
let providedContext: ProtectedContext = { kind: 'onboarded' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: ProtectedContext) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'veh-123' }),
}));

interface LiveProps {
  title: string;
  subtitle?: string;
  backTo: string;
  latitude: number | null;
  longitude: number | null;
}
let captured: LiveProps | null = null;
vi.mock('../components/map/LiveTrackingScreen.js', () => ({
  LiveTrackingScreen: (props: LiveProps) => {
    captured = props;
    return <div data-testid="live-tracking" data-title={props.title} data-back={props.backTo} />;
  },
}));

const { VehiculoLiveRoute } = await import('./vehiculo-live.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  providedContext = { kind: 'onboarded' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VehiculoLiveRoute', () => {
  it('contexto no onboarded → no renderiza tracking', () => {
    providedContext = { kind: 'unmanaged' };
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="live-tracking"]')).toBeNull();
  });

  it('happy: GET /vehiculos/:id/ubicacion + pasa props a LiveTrackingScreen', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicle_id: 'veh-123',
      plate: 'ABCD12',
      teltonika_imei: '111222333',
      ubicacion: {
        timestamp_device: '2026-05-10T10:00:00Z',
        latitude: -33.45,
        longitude: -70.65,
        altitude_m: null,
        angle_deg: 90,
        satellites: 12,
        speed_kmh: 50,
        priority: 1,
      },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(captured?.latitude).toBe(-33.45));
    expect(captured?.title).toBe('ABCD12 · En vivo');
    expect(captured?.subtitle).toBe('IMEI 111222333');
    expect(captured?.backTo).toBe('/app/vehiculos/veh-123');
  });

  it('sin Teltonika → subtitle "Sin Teltonika asociado"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicle_id: 'v',
      plate: 'PQR456',
      teltonika_imei: null,
      ubicacion: {
        timestamp_device: '2026-05-10T10:00:00Z',
        latitude: null,
        longitude: null,
        altitude_m: null,
        angle_deg: null,
        satellites: null,
        speed_kmh: null,
        priority: 1,
      },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(captured?.subtitle).toBe('Sin Teltonika asociado'));
    expect(captured?.title).toBe('Vehículo en vivo');
  });

  it('API error → captured props con title genérico', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom'));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    // El queryFn captura el error y devuelve null → captured.title="Vehículo en vivo"
    await waitFor(() => expect(captured?.title).toBeDefined());
    expect(captured?.title).toBe('Vehículo en vivo');
    expect(captured?.latitude).toBeNull();
  });
});
