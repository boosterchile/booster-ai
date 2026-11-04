import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

const apiGetMock = vi.hoisted(() => vi.fn(async (path: string) => respuestaNav(path)));

function respuestaNav(path: string): unknown {
  if (path.startsWith('/offers/mine')) {
    return { offers: [] };
  }
  if (path === '/assignments') {
    return { assignments: [] };
  }
  if (path === '/cumplimiento') {
    return { resumen: { vencidos: 0, por_vencer_30d: 0 }, vehiculos: [], conductores: [] };
  }
  return {};
}

// El Sidebar usa <Link> + useRouterState de @tanstack/react-router; traer el
// RouterProvider real es overkill. Link → <a>, useRouterState → pathname fijo.
vi.mock('@tanstack/react-router', () => ({
  // `to` → `href` para que el <a> tenga rol "link" en las queries por rol.
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => '/app',
}));

const switchToMock = vi.fn();
vi.mock('../hooks/use-switch-company.js', () => ({
  useSwitchCompany: () => ({ switchTo: switchToMock, isPending: false }),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(async () => undefined),
}));

vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: { ...actual.api, get: (path: string) => apiGetMock(path) },
  };
});

vi.mock('./ConsentTermsBanner.js', () => ({
  ConsentTermsBanner: () => null,
}));

import { signOutUser } from '../hooks/use-auth.js';
import { Layout } from './Layout.js';

const signOutUserMock = vi.mocked(signOutUser);

function renderLayout(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function membership(
  id: string,
  name: string,
  flags: { transportista?: boolean; generador?: boolean } = { generador: true },
) {
  return {
    id: `m-${id}`,
    role: 'dueno' as const,
    status: 'activa' as const,
    joined_at: '2026-01-01T00:00:00Z',
    empresa: {
      id,
      legal_name: name,
      rut: '76.123.456-7',
      is_generador_carga: flags.generador ?? false,
      is_transportista: flags.transportista ?? false,
      status: 'activa' as const,
    },
  };
}

function buildMe(memberships: MeOnboarded['memberships']): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'a@b.cl',
      full_name: 'Ana Pérez',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: false,
      status: 'activo',
      auth_providers: [],
    },
    memberships,
    active_membership: memberships[0] ?? null,
  } as MeOnboarded;
}

describe('Layout — shell con sidebar', () => {
  it('el CompanySwitcher sigue accesible (nombre de la empresa activa)', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>contenido</div>
      </Layout>,
    );
    expect(screen.getAllByText('Naviera Costera').length).toBeGreaterThanOrEqual(1);
  });

  it('renderiza children dentro del main y el title en la topbar', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Contexto de prueba">
        <div>contenido del main</div>
      </Layout>,
    );
    expect(screen.getByText('contenido del main')).toBeInTheDocument();
    expect(screen.getByText('Contexto de prueba')).toBeInTheDocument();
  });

  it('sidebar role-aware: generador ve "Mis cargas", NO "Ofertas"', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Gen', { generador: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('link', { name: /Mis cargas/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Ofertas$/ })).not.toBeInTheDocument();
  });

  it('sidebar dual: transportista y generador ve Ofertas y Mis cargas', () => {
    renderLayout(
      <Layout
        me={buildMe([membership('e-1', 'Van Oosterwyk', { transportista: true, generador: true })])}
        title="Inicio"
      >
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('link', { name: /Ofertas/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Mis cargas/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Crear carga/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Seguimiento de flota/ })).toBeInTheDocument();
  });

  it('sidebar role-aware: transportista ve "Ofertas", NO "Mis cargas"', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('link', { name: /Ofertas/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mis cargas/ })).not.toBeInTheDocument();
  });

  it('hamburguesa abre el drawer (aria-expanded false → true)', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const trigger = screen.getByRole('button', { name: 'Abrir menú' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // el drawer expone un diálogo de navegación
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();
  });

  it('iOS PWA: el header y el drawer reservan el inset superior (pt-safe)', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    // viewport-fit=cover extiende la página bajo la barra de estado en la PWA
    // standalone de iOS: sin el inset, la hamburguesa queda tapada (2026-09-14).
    expect(screen.getByRole('banner')).toHaveClass('pt-safe');
    fireEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
    expect(screen.getByTestId('mobile-drawer')).toHaveClass('pt-safe', 'pb-safe');
  });

  it('click "Salir" llama signOutUser', () => {
    signOutUserMock.mockClear();
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const salir = screen.getAllByRole('button', { name: /Salir/ })[0];
    if (!salir) {
      throw new Error('expected Salir button');
    }
    fireEvent.click(salir);
    expect(signOutUserMock).toHaveBeenCalled();
  });

  it('transportista muestra badges de ofertas, servicios y cumplimiento', async () => {
    apiGetMock.mockImplementation(async (path: string) => {
      if (path.startsWith('/offers/mine')) {
        return { offers: [{ expires_at: '2026-10-19T18:00:00.000Z' }, { expires_at: 'x' }] };
      }
      if (path === '/assignments') {
        return {
          assignments: [
            {
              status: 'asignado',
              driver: null,
              trip: { pickup_window_start: null, origin: { address_raw: 'Origen' } },
            },
          ],
        };
      }
      if (path === '/cumplimiento') {
        return { resumen: { vencidos: 4, por_vencer_30d: 0 }, vehiculos: [], conductores: [] };
      }
      return respuestaNav(path);
    });
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(await screen.findByTestId('nav-badge-ofertas')).toHaveTextContent('2');
    expect(screen.getByTestId('nav-badge-servicios')).toHaveTextContent('1');
    expect(screen.getByTestId('nav-badge-cumplimiento')).toHaveTextContent('4');
  });
});
