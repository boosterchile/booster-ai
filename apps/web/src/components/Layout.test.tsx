import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    return {
      resumen: { vencidos: 0, por_vencer_30d: 0, total_pendientes: 0 },
      vehiculos: [],
      conductores: [],
    };
  }
  return {};
}

// El menú usa <Link> + useRouterState de @tanstack/react-router; traer el
// RouterProvider real es overkill. Link → <a>, useRouterState → `rutaActual`.
const rutaActual = vi.hoisted(() => ({ pathname: '/app' }));
vi.mock('@tanstack/react-router', () => ({
  // `to` → `href` para que el <a> tenga rol "link" en las queries por rol.
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => rutaActual.pathname,
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

import { axe } from 'vitest-axe';
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

describe('Layout — armazón con menú superior (frente 8)', () => {
  beforeEach(() => {
    rutaActual.pathname = '/app';
  });

  const enlaces = (nombre: RegExp) => screen.queryAllByRole('link', { name: nombre });

  it('el menú de cuenta muestra la empresa activa', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>contenido</div>
      </Layout>,
    );
    expect(screen.getByTestId('menu-cuenta')).toHaveTextContent('Naviera Costera');
  });

  it('renderiza children dentro del main y el title como título del documento', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Contexto de prueba">
        <div>contenido del main</div>
      </Layout>,
    );
    expect(within(screen.getByRole('main')).getByText('contenido del main')).toBeInTheDocument();
    expect(document.title).toBe('Contexto de prueba · Booster AI');
  });

  it('sin barra lateral ni cajón: menú en la cabecera y barra inferior', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toHaveClass(
      'hidden',
      'sm:block',
    );
    expect(
      screen.getByRole('navigation', { name: 'Navegación principal en móvil' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('barra-inferior')).toHaveClass('fixed', 'bottom-0', 'sm:hidden');
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir menú' })).not.toBeInTheDocument();
  });

  it('transportista: Inicio, Flota, Viajes, Ofertas y Empresa, en ese orden', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    if (!nav) {
      throw new Error('falta la navegación principal');
    }
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Inicio', 'Flota', 'Viajes', 'Ofertas', 'Empresa']);
    expect(enlaces(/Mis cargas/)).toHaveLength(0);
  });

  it('generador ve «Mis cargas» y «Huella y certificados», no «Ofertas»', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Gen', { generador: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(enlaces(/^Mis cargas$/).length).toBeGreaterThan(0);
    expect(enlaces(/^Huella y certificados$/).length).toBeGreaterThan(0);
    expect(enlaces(/^Ofertas$/)).toHaveLength(0);
  });

  it('la entrada activa lleva aria-current y sus pantallas salen como pestañas', () => {
    rutaActual.pathname = '/app/cargas/nueva';
    renderLayout(
      <Layout
        me={buildMe([membership('e-1', 'Van Oosterwyk', { transportista: true, generador: true })])}
        title="Crear carga"
      >
        <div>x</div>
      </Layout>,
    );
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    if (!nav) {
      throw new Error('falta la navegación principal');
    }
    expect(within(nav).getByRole('link', { name: 'Mis cargas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const pestanas = screen.getByRole('navigation', { name: 'Secciones de Mis cargas' });
    expect(
      within(pestanas)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Crear carga', 'Mis cargas', 'Sucursales']);
    expect(within(pestanas).getByRole('link', { name: 'Crear carga' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('una pantalla dentro de Flota abre sus pestañas', () => {
    rutaActual.pathname = '/app/vehiculos/v-1';
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Vehículo">
        <div>x</div>
      </Layout>,
    );
    const pestanas = screen.getByRole('navigation', { name: 'Secciones de Flota' });
    expect(within(pestanas).getByRole('link', { name: 'Vehículos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(pestanas).getByRole('link', { name: 'Seguimiento de flota' }),
    ).toBeInTheDocument();
  });

  it('la fila de pestañas contiene lo que desborda: es relative y se desplaza en su caja', () => {
    rutaActual.pathname = '/app/vehiculos';
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Vehículos">
        <div>x</div>
      </Layout>,
    );
    const lista = within(screen.getByRole('navigation', { name: 'Secciones de Flota' })).getByRole(
      'list',
    );
    expect(lista).toHaveClass('relative', 'overflow-x-auto');
  });

  it('una entrada con una sola pantalla no muestra pestañas', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.queryByRole('navigation', { name: /^Secciones de/ })).not.toBeInTheDocument();
  });

  it('iOS PWA: la cabecera reserva el inset superior y la barra inferior el inferior', () => {
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('banner')).toHaveClass('pt-safe');
    expect(screen.getByTestId('barra-inferior')).toHaveClass('pb-safe');
  });

  it('menú de cuenta: «Salir» llama signOutUser', () => {
    signOutUserMock.mockClear();
    renderLayout(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const cuenta = screen.getByTestId('menu-cuenta');
    expect(cuenta).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(cuenta);
    expect(cuenta).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /Mi perfil/ })).toHaveAttribute('href', '/app/perfil');
    fireEvent.click(screen.getByRole('button', { name: /Salir/ }));
    expect(signOutUserMock).toHaveBeenCalled();
  });

  it('menú de cuenta: cambia de empresa con varias empresas activas', () => {
    switchToMock.mockClear();
    renderLayout(
      <Layout
        me={buildMe([membership('e-1', 'Naviera Costera'), membership('e-2', 'Frutas del Elqui')])}
        title="Inicio"
      >
        <div>x</div>
      </Layout>,
    );
    fireEvent.click(screen.getByTestId('menu-cuenta'));
    const cambio = screen.getByRole('region', { name: 'Cambiar de empresa' });
    expect(within(cambio).getByRole('button', { name: /Naviera Costera/ })).toBeDisabled();
    fireEvent.click(within(cambio).getByRole('button', { name: /Frutas del Elqui/ }));
    expect(switchToMock).toHaveBeenCalledWith('e-2');
  });

  it('menú de cuenta: el personal de Booster puede volver al panel', () => {
    const me = buildMe([membership('e-1', 'Naviera Costera')]);
    me.user.is_platform_admin = true;
    renderLayout(
      <Layout me={me} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    fireEvent.click(screen.getByTestId('menu-cuenta'));
    expect(screen.getByTestId('menu-panel-booster')).toHaveAttribute('href', '/app/platform-admin');
  });

  it('sin violaciones de axe en el armazón', async () => {
    const { container } = renderLayout(
      <Layout
        me={buildMe([membership('e-1', 'Van Oosterwyk', { transportista: true, generador: true })])}
        title="Inicio"
      >
        <h1>Inicio</h1>
      </Layout>,
    );
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
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
        return {
          resumen: { vencidos: 4, por_vencer_30d: 0, total_pendientes: 4 },
          vehiculos: [],
          conductores: [],
        };
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
