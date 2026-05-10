import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const { AdminCobraHoyRoute } = await import('./admin-cobra-hoy.js');

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: 'dueno',
      status: 'activa',
      empresa: {
        id: 'e',
        legal_name: 'E',
        rut: '76',
        is_generador_carga: false,
        is_transportista: true,
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
      <AdminCobraHoyRoute />
    </Wrapper>,
  );
}

const ADELANTO_SOLICITADO = {
  id: 'a1',
  asignacion_id: 'asg-deadbeef',
  liquidacion_id: 'liq-1',
  empresa_carrier_id: 'car-abcdef12',
  empresa_shipper_id: 'shi-12345678',
  monto_neto_clp: 176000,
  plazo_dias_shipper: 30,
  tarifa_pct: 1.5,
  tarifa_clp: 2640,
  monto_adelantado_clp: 173360,
  status: 'solicitado' as const,
  factoring_methodology_version: 'factoring-v1.0-cl-2026.06',
  desembolsado_en: null,
  cobrado_a_shipper_en: null,
  notas_admin: null,
  creado_en: '2026-05-10T11:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminCobraHoyRoute — gating UX', () => {
  it('contexto unmanaged → render vacío', () => {
    const { container } = renderRoute();
    expect(container.firstChild).toBeNull();
  });

  it('403 forbidden → mensaje claro de allowlist', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'forbidden_platform_admin', null));
    renderRoute();
    expect(await screen.findByText(/Tu cuenta no está en la allowlist/i)).toBeInTheDocument();
  });

  it('503 feature_disabled → banner', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(503, 'feature_disabled', null));
    renderRoute();
    expect(await screen.findByText(/no está activo en este entorno/i)).toBeInTheDocument();
  });
});

describe('AdminCobraHoyRoute — lista + filtros', () => {
  beforeEach(() => {
    providedContext = { kind: 'onboarded', me: makeMe() };
  });

  it('lista vacía → EmptyState', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    renderRoute();
    expect(await screen.findByText(/No hay adelantos con este filtro/i)).toBeInTheDocument();
  });

  it('lista con adelanto solicitado → muestra fila + acciones disponibles', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [ADELANTO_SOLICITADO] });
    renderRoute();
    // Esperamos por contenido único de la fila (no "Solicitado" porque
    // colisiona con el botón del filtro).
    expect(await screen.findByText(/30d · 1\.50%/)).toBeInTheDocument();
    // Botones de transición legales desde 'solicitado'.
    expect(screen.getByRole('button', { name: /Aprobar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rechazar/i })).toBeInTheDocument();
    // "Cancelar" aparece como botón de transición — y todavía no hay panel abierto.
    expect(screen.getAllByRole('button', { name: 'Cancelar' }).length).toBeGreaterThan(0);
    // Transición no permitida desde 'solicitado' no debe aparecer.
    expect(screen.queryByRole('button', { name: /Marcar desembolsado/i })).not.toBeInTheDocument();
  });

  it('cambiar filtro por status → re-query con param', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [] });
    renderRoute();
    await screen.findByText(/No hay adelantos con este filtro/i);
    fireEvent.click(screen.getByRole('button', { name: 'Desembolsado' }));
    await waitFor(() => {
      const calls = getSpy.mock.calls.map((c) => c[0] as string);
      expect(calls.some((url) => url.includes('status=desembolsado'))).toBe(true);
    });
  });
});

describe('AdminCobraHoyRoute — transicionar', () => {
  beforeEach(() => {
    providedContext = { kind: 'onboarded', me: makeMe() };
  });

  it('click Aprobar abre panel de confirmación con notas y dispara POST', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ adelantos: [ADELANTO_SOLICITADO] });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      adelanto_id: 'a1',
      status: 'aprobado',
      desembolsado_en: null,
      cobrado_a_shipper_en: null,
    });
    renderRoute();
    fireEvent.click(await screen.findByRole('button', { name: /Aprobar/i }));
    expect(await screen.findByText(/Confirmar transición/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Notas opcionales/i), {
      target: { value: 'score OK' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/admin/cobra-hoy/adelantos/a1/transicionar',
        expect.objectContaining({ target_status: 'aprobado', notas: 'score OK' }),
      );
    });
  });

  it('estado final cancelado → muestra "Estado final" sin botones', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      adelantos: [{ ...ADELANTO_SOLICITADO, status: 'cancelado' as const }],
    });
    renderRoute();
    expect(await screen.findByText(/Estado final/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprobar/i })).not.toBeInTheDocument();
  });
});
