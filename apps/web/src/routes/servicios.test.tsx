import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

/**
 * `/app/servicios` — el listado que le faltaba al despachador.
 *
 * Medido en prod el 2026-08-03: 0 asignaciones con conductor, con 1 activa.
 * No era descuido: la pantalla que asigna conductor no estaba en el menú y
 * solo se alcanzaba desde Cobra Hoy y Liquidaciones. Esta ruta es la puerta
 * que faltaba, y su trabajo principal es hacer que un servicio SIN conductor
 * se vea como un problema, no como una fila más.
 */

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

let providedContext: { kind: string; me?: MeOnboarded } = { kind: 'unmanaged' };
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: unknown) => ReactNode }) =>
    children(providedContext),
}));

// El mock rinde `<main>` porque el Layout REAL lo hace (Layout.tsx:84). Sin
// eso, el test de axe mediría el mock —y fallaría por `region`— en vez de
// medir la página.
vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main data-testid="layout" data-title={title}>
      {children}
    </main>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: { children: ReactNode; to: string; params?: Record<string, string> }) => {
    const href = params
      ? Object.entries(params).reduce((u, [k, v]) => u.replace(`$${k}`, v), to)
      : to;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const apiGetSpy = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return { ...actual, api: { ...actual.api, get: (...a: unknown[]) => apiGetSpy(...a) } };
});

const { ServiciosRoute } = await import('./servicios.js');

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u1', email: 'jefa@x.cl', full_name: 'Jefa', rut: '11111111-1' },
    memberships: [],
    active_membership: {
      role: 'despachador',
      empresa: {
        id: 'e1',
        legal_name: 'Transportes X',
        is_transportista: true,
        is_generador_carga: false,
      },
    },
  } as unknown as MeOnboarded;
}

function servicio(over: Record<string, unknown> = {}) {
  return {
    id: 'as-1',
    status: 'asignado',
    accepted_at: '2026-08-01T10:00:00Z',
    picked_up_at: null,
    agreed_price_clp: 850000,
    driver: null,
    vehicle: { id: 'v1', plate: 'UICO01' },
    trip: {
      id: 't1',
      tracking_code: 'BOO-4F2A',
      status: 'asignado',
      origin: { address_raw: 'Av. Presidente Riesco 5335', region_code: '13' },
      destination: { address_raw: 'Ruta 5 Sur km 1020', region_code: '10' },
      cargo_type: 'carga_seca',
      cargo_weight_kg: 12000,
      pickup_window_start: null,
      pickup_window_end: null,
    },
    ...over,
  };
}

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiciosRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGetSpy.mockReset();
  providedContext = { kind: 'onboarded', me: makeMe() };
});

describe('/app/servicios', () => {
  it('lista los servicios activos de la empresa', async () => {
    apiGetSpy.mockResolvedValue({ assignments: [servicio()] });
    renderRoute();

    expect(await screen.findByText('BOO-4F2A')).toBeInTheDocument();
    expect(screen.getByText(/Av. Presidente Riesco 5335/)).toBeInTheDocument();
    expect(screen.getByText(/Ruta 5 Sur km 1020/)).toBeInTheDocument();
    expect(apiGetSpy).toHaveBeenCalledWith('/assignments');
  });

  it('un servicio SIN conductor se ve como problema y ofrece asignarlo', async () => {
    apiGetSpy.mockResolvedValue({ assignments: [servicio({ driver: null })] });
    renderRoute();

    // Es el punto entero de la pantalla: sin esto, el conductor nunca ve la
    // carga en su celular y el GPS se rechaza con 403.
    const aviso = await screen.findByTestId('sin-conductor-as-1');
    expect(aviso.textContent ?? '').toMatch(/sin conductor/i);

    const accion = screen.getByTestId('asignar-conductor-as-1');
    expect(accion).toHaveAttribute('href', '/app/asignaciones/as-1');
  });

  it('un servicio CON conductor muestra su nombre y no pide asignar', async () => {
    apiGetSpy.mockResolvedValue({
      assignments: [servicio({ driver: { user_id: 'd1', full_name: 'Pedro Conductor' } })],
    });
    renderRoute();

    expect(await screen.findByText(/Pedro Conductor/)).toBeInTheDocument();
    expect(screen.queryByTestId('sin-conductor-as-1')).not.toBeInTheDocument();
  });

  it('sin servicios explica de dónde salen y enlaza a Ofertas', async () => {
    apiGetSpy.mockResolvedValue({ assignments: [] });
    renderRoute();

    expect(await screen.findByText(/No tienes servicios en curso/i)).toBeInTheDocument();
    const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain('/app/ofertas');
  });

  it('error de carga → mensaje accionable, no el status crudo', async () => {
    apiGetSpy.mockRejectedValue(new Error('boom'));
    renderRoute();

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/no pudimos/i);
    expect(alerta.textContent ?? '').not.toMatch(/boom/);
  });

  it('empresa que no es transportista no ve la lista', async () => {
    const me = makeMe();
    // biome-ignore lint/suspicious/noExplicitAny: shape de test
    (me as any).active_membership.empresa.is_transportista = false;
    providedContext = { kind: 'onboarded', me };
    apiGetSpy.mockResolvedValue({ assignments: [servicio()] });
    renderRoute();

    await waitFor(() => expect(screen.getByTestId('layout')).toBeInTheDocument());
    expect(apiGetSpy).not.toHaveBeenCalled();
  });

  it('no tiene violaciones de a11y (vitest-axe)', async () => {
    apiGetSpy.mockResolvedValue({ assignments: [servicio()] });
    const { axe } = await import('vitest-axe');
    const { baseElement } = renderRoute();
    await screen.findByText('BOO-4F2A');
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
