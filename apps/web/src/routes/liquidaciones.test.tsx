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

const { LiquidacionesRoute } = await import('./liquidaciones.js');

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
      <LiquidacionesRoute />
    </Wrapper>,
  );
}

const LIQ_SIN_DTE = {
  liquidacion_id: 'liq-1',
  asignacion_id: 'asg-1',
  tracking_code: 'TRK-001',
  monto_bruto_clp: 200000,
  comision_pct: 12,
  comision_clp: 24000,
  iva_comision_clp: 4560,
  monto_neto_carrier_clp: 176000,
  total_factura_booster_clp: 28560,
  pricing_methodology_version: 'pricing-v2.0-cl-2026.06',
  status: 'lista_para_dte' as const,
  dte_folio: null,
  dte_emitido_en: null,
  dte_status: null,
  dte_pdf_url: null,
  dte_provider: null,
  creado_en: '2026-05-10T11:00:00Z',
};

const LIQ_DTE_EMITIDO = {
  ...LIQ_SIN_DTE,
  status: 'dte_emitido' as const,
  dte_folio: '1234',
  dte_emitido_en: '2026-05-10T11:01:00Z',
  dte_status: 'aceptado' as const,
  dte_pdf_url: 'https://mock.dte/1234.pdf',
  dte_provider: 'mock',
};

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiquidacionesRoute — gating', () => {
  it('contexto unmanaged → render vacío', () => {
    const { container } = renderRoute();
    expect(container.firstChild).toBeNull();
  });

  it('shipper (no carrier) → mensaje sin permisos', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    renderRoute();
    expect(screen.getByText(/Sin permisos/)).toBeInTheDocument();
    expect(screen.getByText(/exclusivas de empresas transportistas/i)).toBeInTheDocument();
  });

  it('flag off (503) → banner explicativo', async () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'feature_disabled', null));
    renderRoute();
    expect(await screen.findByText(/Las liquidaciones aún no están activas/i)).toBeInTheDocument();
  });

  it('403 no_transportista (defensa en profundidad) → banner danger', async () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden_no_transportista', null));
    renderRoute();
    expect(await screen.findByText(/exclusivas de empresas transportistas/i)).toBeInTheDocument();
  });
});

describe('LiquidacionesRoute — lista', () => {
  beforeEach(() => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
  });

  it('lista vacía → EmptyState', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ liquidaciones: [] });
    renderRoute();
    expect(await screen.findByText(/Aún no tienes liquidaciones/i)).toBeInTheDocument();
  });

  it('liquidación sin DTE → tabla con "—" en columna DTE', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ liquidaciones: [LIQ_SIN_DTE] });
    renderRoute();
    expect(await screen.findByText('Lista para DTE')).toBeInTheDocument();
    expect(screen.getByText('TRK-001')).toBeInTheDocument();
    expect(screen.getByText(/12\.00%/)).toBeInTheDocument();
    // Sin folio.
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
  });

  it('liquidación con DTE aceptado → folio + badge SII aceptado + link PDF', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ liquidaciones: [LIQ_DTE_EMITIDO] });
    renderRoute();
    expect(await screen.findByText('1234')).toBeInTheDocument();
    expect(screen.getByText('SII aceptado')).toBeInTheDocument();
    const pdfLink = screen.getByRole('link', { name: /PDF/i });
    expect(pdfLink).toHaveAttribute('href', 'https://mock.dte/1234.pdf');
    expect(pdfLink).toHaveAttribute('target', '_blank');
  });

  it('summary cards: cuenta + bruto + neto', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      liquidaciones: [LIQ_DTE_EMITIDO, { ...LIQ_SIN_DTE, liquidacion_id: 'liq-2' }],
    });
    renderRoute();
    // Wait until row content visible (esperando la fila — más específico
    // que el h1 que está pre-load).
    expect(await screen.findByText('1234')).toBeInTheDocument();
    // 2 entries × monto_bruto_clp 200000.
    expect(screen.getByText('$ 400.000')).toBeInTheDocument();
    // 2 entries × neto 176000.
    expect(screen.getByText('$ 352.000')).toBeInTheDocument();
  });

  it('liquidación rechazada por SII → badge danger', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      liquidaciones: [{ ...LIQ_DTE_EMITIDO, dte_status: 'rechazado' as const }],
    });
    renderRoute();
    expect(await screen.findByText('SII rechazado')).toBeInTheDocument();
  });
});
