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
  useParams: () => ({ id: 'asn-uuid' }),
}));

vi.mock('../components/chat/ChatPanel.js', () => ({
  ChatPanel: (props: { title: string; readOnly?: boolean }) => (
    <div
      data-testid="chat-panel"
      data-title={props.title}
      data-readonly={props.readOnly ?? false}
    />
  ),
}));

vi.mock('../components/chat/PushSubscribeBanner.js', () => ({
  PushSubscribeBanner: () => <div data-testid="push-banner" />,
}));

vi.mock('../components/scoring/BehaviorScoreCard.js', () => ({
  BehaviorScoreCard: () => <div data-testid="behavior-score" />,
}));

vi.mock('../components/scoring/DeliveryConfirmCard.js', () => ({
  DeliveryConfirmCard: () => <div data-testid="delivery-confirm" />,
}));

vi.mock('../components/transport-documents/TransportDocumentsPanel.js', () => ({
  TransportDocumentsPanel: (props: { tripId: string; canWrite: boolean }) => (
    <div
      data-testid="transport-docs-panel"
      data-trip-id={props.tripId}
      data-can-write={String(props.canWrite)}
    />
  ),
}));

const { AsignacionDetalleRoute } = await import('./asignacion-detalle.js');

function makeMe(
  isTransportista: boolean,
  opts?: { userId?: string; role?: 'dueno' | 'admin' | 'despachador' | 'conductor' },
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: opts?.userId ?? 'u',
      full_name: 'Conductor Ejemplo',
      email: 'conductor@example.com',
      rut: '11.111.111-1',
    } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: opts?.role ?? 'dueno',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Transportes Ejemplo',
        rut: '11.111.111-1',
        is_generador_carga: false,
        is_transportista: isTransportista,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
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
      <AsignacionDetalleRoute />
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

describe('AsignacionDetalleRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = renderRoute();
    expect(container.querySelector('[data-testid="chat-panel"]')).toBeNull();
  });

  it('onboarded pero no transportista → muestra "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    renderRoute();
    expect(screen.getByText('Sin permisos')).toBeInTheDocument();
  });

  function assignmentActivo(driverUserId: string) {
    return {
      trip_request: {
        id: 't1',
        tracking_code: 'BOO-TEST01',
        status: 'asignado',
        origin: { address_raw: 'Origen ejemplo 100', region_code: 'XIII' },
        destination: { address_raw: 'Destino ejemplo 200', region_code: 'V' },
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        shipper_legal_name: 'Generador Ejemplo',
      },
      assignment: {
        id: 'a1',
        status: 'asignado',
        driver_user_id: driverUserId,
        driver_name: 'Conductor Ejemplo',
        vehicle_id: 'v-1',
        vehicle_plate: 'TEST01',
      },
    };
  }

  it('el administrador que no conduce el viaje no ve entrega ni incidente', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(assignmentActivo('user-conductor'));
    providedContext = { kind: 'onboarded', me: makeMe(true, { userId: 'user-admin' }) };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('asignacion-ejecucion')).toBeInTheDocument());
    expect(screen.queryByTestId('delivery-confirm')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /reportar incidente/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('behavior-score')).not.toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-trip-id', 't1');
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-can-write', 'true');
  });

  it('el conductor asignado ve entrega e incidente aunque su rol sea dueño', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(assignmentActivo('user-conductor'));
    providedContext = {
      kind: 'onboarded',
      me: makeMe(true, { userId: 'user-conductor', role: 'dueno' }),
    };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('delivery-confirm')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: /reportar incidente/i })).toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-can-write', 'true');
  });

  it('rol conductor que no es el asignado tampoco ve las acciones del viaje', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(assignmentActivo('user-conductor'));
    providedContext = {
      kind: 'onboarded',
      me: makeMe(true, { userId: 'user-otro', role: 'conductor' }),
    };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('asignacion-ejecucion')).toBeInTheDocument());
    expect(screen.queryByTestId('delivery-confirm')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /reportar incidente/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-can-write', 'false');
  });

  it('transportista + status entregado → BehaviorScoreCard + chat readOnly', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        tracking_code: 'BST-002',
        status: 'entregado',
        origin: { address_raw: 'A', region_code: 'XIII' },
        destination: { address_raw: 'B', region_code: 'V' },
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        shipper_legal_name: 'ACME',
      },
      assignment: { id: 'a1', status: 'entregado' } as never,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('behavior-score')).toBeInTheDocument());
    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-readonly', 'true');
    expect(screen.queryByTestId('delivery-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('transport-docs-panel')).toHaveAttribute('data-trip-id', 't1');
  });

  it('shipper_legal_name null → chat title con fallback', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        tracking_code: 'BST-003',
        status: 'asignado',
        origin: { address_raw: 'A', region_code: 'XIII' },
        destination: { address_raw: 'B', region_code: 'V' },
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        shipper_legal_name: null,
      },
      assignment: {
        id: 'a1',
        status: 'asignado',
        driver_user_id: 'u-driver',
        vehicle_id: 'v-1',
      } as never,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    await waitFor(() =>
      expect(screen.getByTestId('chat-panel')).toHaveAttribute(
        'data-title',
        'Chat con generador de carga',
      ),
    );
  });

  it('paso de asignación sin conductor → solo el formulario, sin ejecución del viaje', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (String(path).startsWith('/assignments/')) {
        return {
          trip_request: {
            id: 't1',
            tracking_code: 'BOO-HC7DJX',
            status: 'asignado',
            origin: { address_raw: 'A', region_code: 'XIII' },
            destination: { address_raw: 'B', region_code: 'V' },
            cargo_type: 'carga_seca',
            cargo_weight_kg: 5000,
            shipper_legal_name: 'ACME',
          },
          assignment: {
            id: 'a1',
            status: 'asignado',
            driver_user_id: null,
            driver_name: null,
            vehicle_id: 'v-1',
          },
        };
      }
      if (path === '/conductores') {
        return {
          conductores: [
            {
              id: 'c-pend',
              user_id: 'u-pend',
              status: 'activo',
              user: {
                id: 'u-pend',
                full_name: 'Conductor pendiente',
                rut: '11.111.111-1',
                email: 'pendiente@example.com',
                is_pending: true,
              },
            },
          ],
        };
      }
      if (path === '/vehiculos') {
        return {
          vehicles: [
            {
              id: 'v-1',
              plate: 'ABCD12',
              type: 'camion_pesado',
              unit_category: 'motriz',
              status: 'activo',
            },
          ],
        };
      }
      throw new Error(`GET inesperado: ${path}`);
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    expect(await screen.findByTestId('driver-assignment-card')).toBeInTheDocument();
    expect(await screen.findByTestId('vehicle-assignment-select')).toBeInTheDocument();
    expect(screen.getByTestId('driver-assignment-select')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.queryByTestId('asignacion-ejecucion')).not.toBeInTheDocument();
    expect(screen.queryByTestId('delivery-confirm')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('transport-docs-panel')).not.toBeInTheDocument();
  });

  it('sin data (loading) → tracking code es slice del assignment id y aún no monta docs', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => undefined));
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    // El header siempre se renderiza con fallback al assignmentId.slice(0,8).
    expect(screen.getByText(/asn-uuid/)).toBeInTheDocument();
    expect(screen.queryByTestId('transport-docs-panel')).toBeNull();
  });
});
