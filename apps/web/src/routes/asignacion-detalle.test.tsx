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

const { AsignacionDetalleRoute } = await import('./asignacion-detalle.js');

function makeMe(isTransportista: boolean): MeOnboarded {
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

  it('transportista + status asignado → muestra DeliveryConfirmCard', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 't1',
        tracking_code: 'BST-001',
        status: 'asignado',
        origin: { address_raw: 'A', region_code: 'XIII' },
        destination: { address_raw: 'B', region_code: 'V' },
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        shipper_legal_name: 'ACME',
      },
      assignment: { id: 'a1', status: 'asignado' } as never,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('delivery-confirm')).toBeInTheDocument());
    expect(screen.queryByTestId('behavior-score')).not.toBeInTheDocument();
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
      assignment: { id: 'a1', status: 'asignado' } as never,
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

  it('sin data (loading) → tracking code es slice del assignment id', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => undefined));
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    // El header siempre se renderiza con fallback al assignmentId.slice(0,8).
    expect(screen.getByText(/asn-uuid/)).toBeInTheDocument();
  });
});
