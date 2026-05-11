import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

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
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('../components/EmptyState.js', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  emptyStateActionClass: 'btn',
}));

const { CobraHoyHistorialRoute } = await import('./cobra-hoy-historial.js');

function makeMe(isCarrier: boolean): MeOnboarded {
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
        is_transportista: isCarrier,
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
      <CobraHoyHistorialRoute />
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

describe('CobraHoyHistorialRoute — gating', () => {
  it('contexto unmanaged → render vacío', () => {
    const { container } = renderRoute();
    expect(container.firstChild).toBeNull();
  });

  it('shipper (no transportista) → mensaje sin permisos', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    renderRoute();
    expect(screen.getByText(/Sin permisos/)).toBeInTheDocument();
    expect(screen.getByText(/exclusivo de empresas transportistas/i)).toBeInTheDocument();
  });
});

describe('CobraHoyHistorialRoute — estados de datos', () => {
  beforeEach(() => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
  });

  it('feature disabled (503) → banner explicativo', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'feature_disabled', null));
    renderRoute();
    expect(
      await screen.findByText(/La opción de pronto pago todavía no está activa/i),
    ).toBeInTheDocument();
  });

  it('historial vacío → EmptyState', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    renderRoute();
    expect(
      await screen.findByText(/Aún no tienes solicitudes de pronto pago/i),
    ).toBeInTheDocument();
  });

  it('con adelantos → tabla con summary cards y filas', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      adelantos: [
        {
          id: 'a1',
          asignacion_id: 'asg-deadbeef-1234',
          monto_neto_clp: 176000,
          plazo_dias_shipper: 30,
          tarifa_pct: 1.5,
          tarifa_clp: 2640,
          monto_adelantado_clp: 173360,
          status: 'desembolsado' as const,
          desembolsado_en: '2026-05-08T12:00:00Z',
          creado_en: '2026-05-08T11:00:00Z',
          nota_visible: null,
        },
      ],
    });
    renderRoute();
    expect(await screen.findByText(/Solicitudes/)).toBeInTheDocument();
    expect(screen.getByText(/Total adelantado/)).toBeInTheDocument();
    expect(screen.getByText(/Total tarifa/)).toBeInTheDocument();
    expect(screen.getByText('Desembolsado')).toBeInTheDocument();
    // Tarifa formateada con porcentaje.
    expect(screen.getByText(/\(1\.50%\)/)).toBeInTheDocument();
    // Sin nota visible: el bloque NotaCarrier no debe aparecer.
    expect(screen.queryByText(/Nota del equipo Booster/)).not.toBeInTheDocument();
  });

  it('rechazado con nota_visible → muestra NotaCarrier con AlertTriangle', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      adelantos: [
        {
          id: 'a1',
          asignacion_id: 'asg-1',
          monto_neto_clp: 176000,
          plazo_dias_shipper: 30,
          tarifa_pct: 1.5,
          tarifa_clp: 2640,
          monto_adelantado_clp: 173360,
          status: 'rechazado' as const,
          desembolsado_en: null,
          creado_en: '2026-05-08T11:00:00Z',
          nota_visible: 'Score insuficiente del shipper',
        },
      ],
    });
    renderRoute();
    expect(await screen.findByText('Rechazado')).toBeInTheDocument();
    expect(screen.getByText(/Nota del equipo Booster/)).toBeInTheDocument();
    expect(screen.getByText(/Score insuficiente del shipper/)).toBeInTheDocument();
  });

  it('mora con nota_visible → muestra NotaCarrier en tono amber', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      adelantos: [
        {
          id: 'a1',
          asignacion_id: 'asg-1',
          monto_neto_clp: 176000,
          plazo_dias_shipper: 30,
          tarifa_pct: 1.5,
          tarifa_clp: 2640,
          monto_adelantado_clp: 173360,
          status: 'mora' as const,
          desembolsado_en: '2026-04-01T12:00:00Z',
          creado_en: '2026-04-01T11:00:00Z',
          nota_visible: 'auto-mora: shipper no pagó en plazo (10 días vencidos sobre 30).',
        },
      ],
    });
    renderRoute();
    expect(await screen.findByText('En mora')).toBeInTheDocument();
    expect(screen.getByText(/auto-mora: shipper no pagó en plazo/)).toBeInTheDocument();
  });

  it('adelanto con status sin nota_visible → no muestra panel de nota', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      adelantos: [
        {
          id: 'a1',
          asignacion_id: 'asg-1',
          monto_neto_clp: 176000,
          plazo_dias_shipper: 30,
          tarifa_pct: 1.5,
          tarifa_clp: 2640,
          monto_adelantado_clp: 173360,
          status: 'rechazado' as const,
          desembolsado_en: null,
          creado_en: '2026-05-08T11:00:00Z',
          // nota_visible null (admin no dejó motivo)
          nota_visible: null,
        },
      ],
    });
    renderRoute();
    expect(await screen.findByText('Rechazado')).toBeInTheDocument();
    expect(screen.queryByText(/Nota del equipo Booster/)).not.toBeInTheDocument();
  });
});
