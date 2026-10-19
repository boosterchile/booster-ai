import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMe } from '../../hooks/use-me.js';
import { ApiError, setActiveEmpresaId } from '../../lib/api-client.js';
import { Sidebar } from '../Sidebar.js';
import { InicioTransportista } from './inicio-transportista.js';

/**
 * Tope por endpoint al montar el Inicio (y el shell que lo acompaña).
 * StrictMode puede repetir el efecto una vez; un tercer fetch ya es un loop.
 */
const MAX_POR_ENDPOINT = 2;

const apiGetSpy = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : undefined} {...props}>
      {children}
    </a>
  ),
  Navigate: () => null,
  useRouterState: () => '/app',
  useNavigate: () => vi.fn(),
}));

vi.mock('../../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(),
}));

vi.mock('../../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client.js')>('../../lib/api-client.js');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (path: string, init?: RequestInit) => apiGetSpy(path, init),
    },
  };
});

function respuesta(path: string): unknown {
  if (path === '/me') {
    return {
      needs_onboarding: false,
      user: {
        id: 'u',
        email: 'maria@transporte.cl',
        full_name: 'María José Pérez',
        phone: null,
        whatsapp_e164: null,
        rut: null,
        is_platform_admin: false,
        status: 'activo',
      },
      memberships: [],
      active_membership: {
        id: 'm',
        role: 'dueno',
        status: 'activa',
        joined_at: null,
        empresa: {
          id: 'emp-1',
          legal_name: 'Transportes Van Oosterwyk',
          rut: '76.000.000-0',
          is_generador_carga: false,
          is_transportista: true,
          status: 'activa',
        },
      },
    };
  }
  if (path.startsWith('/offers/mine')) {
    return { offers: [] };
  }
  if (path === '/assignments') {
    return { assignments: [] };
  }
  if (path === '/cumplimiento') {
    return { resumen: { vencidos: 0, por_vencer_30d: 0 }, vehiculos: [], conductores: [] };
  }
  if (path === '/vehiculos/flota') {
    return { fleet: [] };
  }
  if (path === '/vehiculos') {
    return { vehicles: [{ id: 'v1' }] };
  }
  if (path === '/conductores') {
    return { conductores: [{ id: 'c1' }] };
  }
  if (path === '/me/cobra-hoy/historial') {
    return { enabled: false, items: [] };
  }
  return {};
}

function conteo(path: string): number {
  return apiGetSpy.mock.calls.filter((call) => call[0] === path).length;
}

function clienteProduccion(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount) => failureCount < 3,
      },
    },
  });
}

function Shell() {
  const me = useMe({ enabled: true });
  if (!me.data || me.data.needs_onboarding) {
    return null;
  }
  const empresa = me.data.active_membership?.empresa;
  if (!empresa) {
    return null;
  }
  return (
    <>
      <Sidebar me={me.data} />
      <InicioTransportista
        nombreCompleto={me.data.user.full_name}
        legalName={empresa.legal_name}
        esAdmin
      />
    </>
  );
}

function renderShell() {
  const client = clienteProduccion();
  const ui = (marca: number) => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <Shell key={marca} />
      </QueryClientProvider>
    </StrictMode>
  );
  const view = render(ui(0));
  return { ...view, repetir: () => view.rerender(ui(0)) };
}

describe('Inicio transportista — refetch al montar', () => {
  beforeEach(() => {
    apiGetSpy.mockReset();
    apiGetSpy.mockImplementation(async (path: string) => respuesta(path));
    setActiveEmpresaId('emp-1');
  });

  afterEach(() => {
    setActiveEmpresaId(null);
    vi.useRealTimers();
  });

  it('no supera N requests por endpoint al montar ni si el padre se re-renderiza', async () => {
    const view = renderShell();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('María');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(heading.textContent).toMatch(/^(Buenos días|Buenas tardes|Buenas noches), María$/);
    expect(heading.textContent).not.toContain('Transportes');
    expect(screen.getByText('Sin ofertas nuevas')).toBeInTheDocument();

    const endpoints = [
      '/me',
      '/vehiculos/flota',
      '/assignments',
      '/cumplimiento',
      '/me/cobra-hoy/historial',
    ] as const;
    for (const path of endpoints) {
      expect(conteo(path), path).toBeGreaterThan(0);
      expect(conteo(path), path).toBeLessThanOrEqual(MAX_POR_ENDPOINT);
    }

    view.repetir();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    for (const path of endpoints) {
      expect(conteo(path), path).toBeLessThanOrEqual(MAX_POR_ENDPOINT);
    }
  });

  it('seguir en el Inicio dos minutos no vuelve a pedir los mismos endpoints', async () => {
    vi.useFakeTimers();
    renderShell();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('María');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    for (const path of [
      '/me',
      '/vehiculos/flota',
      '/assignments',
      '/cumplimiento',
      '/offers/mine?status=pendiente',
      '/me/cobra-hoy/historial',
    ]) {
      expect(conteo(path), path).toBeLessThanOrEqual(MAX_POR_ENDPOINT);
    }
  });

  it('un bloque caído no esconde el saludo ni el resto, y no hay montos', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path === '/vehiculos/flota') {
        throw new ApiError(500, undefined, null, 'boom');
      }
      return respuesta(path);
    });
    renderShell();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('María');
    expect(await screen.findByText('Sin ofertas nuevas')).toBeInTheDocument();
    expect(await screen.findByText('No cargó Flota')).toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('inicio-plata')).not.toBeInTheDocument();
    expect(conteo('/assignments')).toBeGreaterThan(0);
  });

  it('sin full_name el saludo no usa la primera palabra de la empresa', async () => {
    const client = clienteProduccion();
    render(
      <QueryClientProvider client={client}>
        <InicioTransportista
          nombreCompleto="   "
          legalName="Transportes Van Oosterwyk"
          esAdmin={false}
        />
      </QueryClientProvider>,
    );
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toMatch(/^(Buenos días|Buenas tardes|Buenas noches)$/);
    expect(heading.textContent).not.toContain('Transportes');
  });
});
