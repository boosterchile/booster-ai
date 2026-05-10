import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useParams: () => ({ id: 'trip-1' }),
}));

vi.mock('../components/map/LiveTrackingScreen.js', () => ({
  LiveTrackingScreen: (props: {
    title: string;
    latitude: number | null;
    bottomExtra?: ReactNode;
  }) => (
    <div data-testid="live-tracking" data-title={props.title} data-has-pos={props.latitude != null}>
      {props.bottomExtra}
    </div>
  ),
}));

vi.mock('../components/chat/ChatPanel.js', () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock('../components/chat/PushSubscribeBanner.js', () => ({
  PushSubscribeBanner: () => <div data-testid="push-banner" />,
}));

const { CargaTrackRoute } = await import('./carga-track.js');

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: null,
  } as MeOnboarded;
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderRoute() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <CargaTrackRoute />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CargaTrackRoute', () => {
  it('no onboarded → no renderiza tracking', () => {
    const { container } = renderRoute();
    expect(container.querySelector('[data-testid="live-tracking"]')).toBeNull();
  });

  it('onboarded + sin asignación → LiveTrackingScreen sin posición', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        status: 'sin_asignar',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
      },
      assignment: null,
    });
    renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('live-tracking')).toHaveAttribute('data-has-pos', 'false'),
    );
  });

  it('onboarded + asignación con ubicación → LiveTrackingScreen con plate en title', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        status: 'en_proceso',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
      },
      assignment: {
        id: 'a1',
        status: 'en_proceso',
        empresa_legal_name: 'Transportes Andes',
        vehicle_plate: 'ABCD12',
        vehicle_type: 'camion',
        driver_name: 'Pedro',
        ubicacion_actual: {
          timestamp_device: '2026-05-10T10:00:00Z',
          latitude: -33.45,
          longitude: -70.65,
          speed_kmh: 50,
          angle_deg: 90,
        },
      },
    });
    renderRoute();
    await waitFor(() => {
      const lt = screen.getByTestId('live-tracking');
      expect(lt).toHaveAttribute('data-has-pos', 'true');
      expect(lt).toHaveAttribute('data-title', expect.stringContaining('ABCD12'));
    });
  });

  it('click "Chat con transportista" abre ChatPanel overlay', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        status: 'en_proceso',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
      },
      assignment: {
        id: 'a1',
        status: 'en_proceso',
        empresa_legal_name: 'TA',
        vehicle_plate: 'ABCD12',
        vehicle_type: null,
        driver_name: null,
        ubicacion_actual: null,
      },
    });
    renderRoute();
    const btn = await screen.findByRole('button', { name: /Abrir chat/ });
    fireEvent.click(btn);
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();
  });
});
