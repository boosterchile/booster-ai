import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';
import { LIVE_TRACKING_FETCH } from '../lib/live-tracking.js';

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

vi.mock('../components/transport-documents/TransportDocumentsPanel.js', () => ({
  TransportDocumentsPanel: (props: { tripId: string; canWrite: boolean; compact?: boolean }) => (
    <div
      data-testid="transport-docs-panel"
      data-trip-id={props.tripId}
      data-can-write={String(props.canWrite)}
      data-compact={String(props.compact ?? false)}
    />
  ),
}));

const { CargaTrackRoute } = await import('./carga-track.js');

function makeMe(
  role?: 'dueno' | 'admin' | 'despachador' | 'conductor' | 'visualizador',
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: role
      ? ({
          id: 'm',
          role,
          status: 'activa',
          joined_at: null,
          empresa: {
            id: 'e',
            legal_name: 'E',
            rut: '76',
            is_generador_carga: true,
            is_transportista: false,
            status: 'activa',
          },
        } as MeOnboarded['active_membership'])
      : null,
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
    const docs = screen.getByTestId('transport-docs-panel');
    expect(docs).toHaveAttribute('data-trip-id', 'trip-1');
    expect(docs).toHaveAttribute('data-compact', 'true');
    expect(docs).toHaveAttribute('data-can-write', 'false');
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

  // ---- Tracking en vivo unificado (.specs/tracking-live-unificado/) ----

  function liveDetail(over: {
    ubicacion: boolean;
    position_source: 'teltonika' | 'mobile' | null;
    eta_minutes: number | null;
  }) {
    return {
      trip_request: {
        id: 't1',
        status: 'en_proceso',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'IV',
      },
      assignment: {
        id: 'a1',
        status: 'recogido',
        empresa_legal_name: 'Transportes Andes',
        vehicle_plate: 'ABCD12',
        vehicle_type: 'camion',
        driver_name: 'Pedro',
        ubicacion_actual: over.ubicacion
          ? {
              timestamp_device: '2026-09-20T15:00:00Z',
              latitude: -33.45,
              longitude: -70.65,
              speed_kmh: 50,
              angle_deg: 90,
            }
          : null,
        position_source: over.position_source,
        eta_minutes: over.eta_minutes,
      },
    };
  }

  it('solo GPS del móvil → posición + «Llegada estimada» + «teléfono del conductor»', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce(
      liveDetail({ ubicacion: true, position_source: 'mobile', eta_minutes: 42 }),
    );
    renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('live-tracking')).toHaveAttribute('data-has-pos', 'true'),
    );
    expect(screen.getByText(/Llegada estimada/i)).toHaveTextContent('en 42 min');
    expect(screen.getByText(/teléfono del conductor/i)).toBeInTheDocument();
  });

  it('Teltonika sin ETA → «GPS del vehículo» y «no disponible aún»', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce(
      liveDetail({ ubicacion: true, position_source: 'teltonika', eta_minutes: null }),
    );
    renderRoute();
    await waitFor(() => expect(screen.getByText(/GPS del vehículo/i)).toBeInTheDocument());
    expect(screen.getByText(/Llegada estimada/i)).toHaveTextContent('no disponible aún');
  });

  it('sin posición → no promete ETA ni fuente', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockResolvedValueOnce(
      liveDetail({ ubicacion: false, position_source: null, eta_minutes: null }),
    );
    renderRoute();
    // Esperar la tarjeta del assignment: `data-has-pos=false` también es cierto mientras carga.
    expect(await screen.findByText('Transportes Andes')).toBeInTheDocument();
    expect(screen.getByTestId('live-tracking')).toHaveAttribute('data-has-pos', 'false');
    expect(screen.queryByText(/Llegada estimada/i)).toBeNull();
    expect(screen.queryByText(/Posición reportada/i)).toBeNull();
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

  it('en_proceso vuelve a pedir la ubicación dentro de 15s y sin caché HTTP', async () => {
    vi.useFakeTimers();
    providedContext = { kind: 'onboarded', me: makeMe() };
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({
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
        status: 'recogido',
        empresa_legal_name: 'Transportes Andes',
        vehicle_plate: 'ABCD12',
        vehicle_type: 'camion',
        driver_name: 'Pedro',
        ubicacion_actual: {
          timestamp_device: '2026-09-21T19:00:00.000Z',
          latitude: -33.39729,
          longitude: -70.79487,
          speed_kmh: 29.02,
          angle_deg: 90,
        },
        position_source: 'mobile',
        eta_minutes: 114,
      },
    });
    try {
      renderRoute();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(getSpy).toHaveBeenCalledWith('/trip-requests-v2/trip-1', LIVE_TRACKING_FETCH);
      const afterFirst = getSpy.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(getSpy.mock.calls.length).toBeGreaterThan(afterFirst);
    } finally {
      vi.useRealTimers();
    }
  });

  it('generador dueño → panel documental con tripId de ruta y canWrite', async () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno') };
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
        vehicle_plate: null,
        vehicle_type: null,
        driver_name: null,
        ubicacion_actual: null,
      },
    });
    renderRoute();
    const docs = await screen.findByTestId('transport-docs-panel');
    expect(docs).toHaveAttribute('data-trip-id', 'trip-1');
    expect(docs).toHaveAttribute('data-can-write', 'true');
    expect(docs).toHaveAttribute('data-compact', 'true');
  });
});
