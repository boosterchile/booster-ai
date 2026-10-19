import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { MeResponse } from '../hooks/use-me.js';

// Layout (usado por AppRoute) internamente usa TanStack Query (vía
// useSwitchCompany). Sin QueryClientProvider, los tests revientan.
function renderWithQueryClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  // D9 — el dashboard renderiza <Navigate to="/app/conductor" /> cuando
  // el rol activo es conductor. Stub que no crashea en tests sin router real.
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
  // Layout → Sidebar usa useRouterState para el item activo.
  useRouterState: () => '/app',
}));

const signOutUserMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: signOutUserMock,
}));

const apiGetSpy = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return { ...actual, api: { ...actual.api, get: (...args: unknown[]) => apiGetSpy(...args) } };
});

const { AppRoute } = await import('./app.js');

function respuestaVacia(path: string): unknown {
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
  if (path === '/vehiculos/flota') {
    return { fleet: [] };
  }
  if (path === '/vehiculos') {
    return {
      vehicles: [
        {
          id: 'v1',
          plate: 'ABCD12',
          type: 'camion_mediano',
          capacity_kg: 1000,
          status: 'activo',
        },
      ],
    };
  }
  if (path === '/conductores') {
    return { conductores: [{ id: 'c1' }] };
  }
  if (path.startsWith('/trip-requests-v2')) {
    return { trip_requests: [] };
  }
  if (path.startsWith('/certificates')) {
    return { certificates: [] };
  }
  return {};
}

function makeMe(
  role: NonNullable<MeOnboarded['active_membership']>['role'] = 'dueno',
  isCarrier = true,
  isShipper = true,
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Felipe', email: 'a@b.cl' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e1',
        legal_name: 'Booster SpA',
        rut: '76',
        is_generador_carga: isShipper,
        is_transportista: isCarrier,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
  apiGetSpy.mockImplementation(async (path: string) => respuestaVacia(path));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppRoute', () => {
  it('contexto no onboarded → no renderiza dashboard', () => {
    const { container } = renderWithQueryClient(<AppRoute />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('transportista y generador → saludo nuevo y la sección de generador debajo', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Felipe/);
    expect(screen.queryByRole('heading', { name: 'Bienvenido a Booster' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Booster SpA').length).toBeGreaterThan(0);
    expect(screen.getByText(/· Transportista/)).toBeInTheDocument();
    expect(await screen.findByText(/Origen, destino, tipo de carga/)).toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('carrier → el acceso Ofertas conserva el destino', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('dashboard-link-ofertas')).toHaveAttribute('href', '/app/ofertas');
    expect(screen.getByTestId('dashboard-link-flota')).toHaveAttribute('href', '/app/flota');
    expect(screen.getByTestId('dashboard-link-conductores')).toHaveAttribute(
      'href',
      '/app/conductores',
    );
    expect(screen.getByTestId('dashboard-link-cumplimiento')).toHaveAttribute(
      'href',
      '/app/cumplimiento',
    );
    expect(screen.getByTestId('dashboard-link-servicios')).toHaveAttribute(
      'href',
      '/app/servicios',
    );
    expect(screen.getByTestId('dashboard-link-vehiculos')).toHaveAttribute(
      'href',
      '/app/vehiculos',
    );
    expect(screen.getByTestId('dashboard-link-cobra-hoy')).toHaveAttribute(
      'href',
      '/app/cobra-hoy/historial',
    );
    expect(screen.getByTestId('dashboard-link-liquidaciones')).toHaveAttribute(
      'href',
      '/app/liquidaciones',
    );
    // La grilla vive solo en mobile (md:hidden). Los testid siguen en el DOM.
    expect(screen.getByTestId('inicio-accesos')).toHaveClass('md:hidden');
  });

  it('shipper → muestra el inicio del generador y la CTA de publicar', async () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', false, true) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByTestId('inicio-generador')).toBeInTheDocument();
    expect(screen.getAllByText('Publicar carga').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Origen, destino, tipo de carga/)).not.toBeInTheDocument();
  });

  it('el shell + dashboard operador no tiene violaciones de a11y (vitest-axe)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, true) };
    const { baseElement } = renderWithQueryClient(<AppRoute />);
    await screen.findByText('Sin ofertas nuevas');
    // color-contrast off: jsdom no computa layout/canvas (lo cubre ui-tokens).
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    // Sin matcher (el .d.ts de vitest-axe exporta el matcher type-only): axe cubre
    // la a11y semántica; violations vacío = sin violaciones.
    expect(results.violations).toEqual([]);
  });

  it('admin + transportista → muestra Trayectos y Dispositivos', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe('admin', true, false),
    };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('dashboard-link-dispositivos')).toHaveAttribute(
      'href',
      '/app/admin/dispositivos',
    );
    expect(screen.getByTestId('dashboard-link-trayectos')).toHaveAttribute(
      'href',
      '/app/trayectos',
    );
  });

  it('despachador (operador) ve el inicio y no los accesos de admin', () => {
    providedContext = { kind: 'onboarded', me: makeMe('despachador', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('inicio-transportista')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-link-dispositivos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-link-trayectos')).not.toBeInTheDocument();
  });

  it('no admin → no muestra admin dispositivos', () => {
    // D9: rol conductor ahora redirige a /app/conductor (dashboard del
    // conductor), así que en vez de chequear el dashboard carrier
    // chequeamos que el Navigate stub aparezca y que "Dispositivos
    // pendientes" NO esté.
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    renderWithQueryClient(<AppRoute />);
    expect(screen.queryByTestId('dashboard-link-dispositivos')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-link-trayectos')).not.toBeInTheDocument();
  });

  it('rol stakeholder → redirige a sus zonas', () => {
    providedContext = { kind: 'onboarded', me: makeMe('stakeholder_sostenibilidad') };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/stakeholder/zonas');
    expect(screen.queryByTestId('inicio-transportista')).not.toBeInTheDocument();
  });

  it('generador puro saluda por nombre y no monta el inicio del transportista', async () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', false, true) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByRole('heading', { name: /Felipe/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bienvenido a Booster' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('inicio-transportista')).not.toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('rol conductor → redirige a /app/conductor (D9 surface guard)', () => {
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/conductor');
    // El dashboard original NO debería renderizarse.
    expect(screen.queryByText('Bienvenido a Booster')).not.toBeInTheDocument();
  });

  it('platform admin → redirige a /app/platform-admin (sin importar memberships)', () => {
    const me = makeMe();
    (me.user as { is_platform_admin?: boolean }).is_platform_admin = true;
    providedContext = { kind: 'onboarded', me };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/platform-admin');
    expect(screen.queryByText('Bienvenido a Booster')).not.toBeInTheDocument();
  });

  it('platform admin SIN memberships (auto-provisioned) → redirige a /app/platform-admin', () => {
    const me: MeOnboarded = {
      needs_onboarding: false,
      user: {
        id: 'u',
        email: 'admin@boosterchile.com',
        full_name: 'Admin',
        phone: null,
        whatsapp_e164: null,
        rut: null,
        is_platform_admin: true,
        status: 'activo',
      },
      memberships: [],
      active_membership: null,
    };
    providedContext = { kind: 'onboarded', me };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/platform-admin');
  });

  it('click Salir (vía menú mobile) → signOutUser', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    renderWithQueryClient(<AppRoute />);
    await screen.findByText('Sin ofertas nuevas');
    // En mobile, el botón Salir vive dentro del panel del menú
    // hamburguesa. Abrir menú primero.
    const menuButton = screen.getByRole('button', { name: 'Abrir menú' });
    menuButton.click();
    // El botón Salir del menú mobile tiene el texto literal "Salir".
    const salir = screen.getByRole('button', { name: /Salir/i });
    salir.click();
    expect(signOutUserMock).toHaveBeenCalled();
  });

  it('conteo 0 no muestra la fila y el estado queda calmo', async () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByText('Sin ofertas nuevas')).toBeInTheDocument();
    expect(screen.getByText('Sin retiros próximos')).toBeInTheDocument();
    expect(screen.queryByText(/ofertas por responder/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sin conductor/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/documento vencido/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/vehículo sin señal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
    expect(screen.getAllByText('Cobra hoy').length).toBeGreaterThan(0);
  });

  it('empresa nueva muestra el alta y no los KPIs', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path === '/vehiculos') {
        return { vehicles: [] };
      }
      if (path === '/conductores') {
        return { conductores: [] };
      }
      return respuestaVacia(path);
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByRole('heading', { name: /Bienvenido, Felipe/ })).toBeInTheDocument();
    expect(screen.getByText('Dejemos tu empresa lista para recibir cargas')).toBeInTheDocument();
    expect(screen.getByText('1 de 4')).toBeInTheDocument();
    expect(screen.queryByText(/10 minutos/)).not.toBeInTheDocument();
    expect(screen.getByText('Sin ofertas nuevas')).toBeInTheDocument();
    expect(screen.getByText('Tu negocio hoy')).toBeInTheDocument();
    expect(screen.queryByText('Tu operación hoy')).not.toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Agrega tu primer vehículo/ })).toHaveAttribute(
      'href',
      '/app/vehiculos',
    );
  });

  it('los accesos se pintan aunque la API todavía no responda', () => {
    apiGetSpy.mockImplementation(() => new Promise(() => undefined));
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByTestId('dashboard-link-flota')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-link-conductores')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-link-cumplimiento')).toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('error aislado de cumplimiento deja el resto y permite reintentar', async () => {
    const vence = new Date(Date.now() + 42 * 60_000).toISOString();
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path === '/cumplimiento') {
        throw new Error('cumplimiento caído');
      }
      if (path.startsWith('/offers/mine')) {
        return { offers: [{ expires_at: vence }] };
      }
      return respuestaVacia(path);
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByText('No cargó Cumplimiento')).toBeInTheDocument();
    expect(screen.getByText('El resto del Inicio sigue funcionando')).toBeInTheDocument();
    expect(await screen.findByText('1 oferta nueva')).toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
    const antes = apiGetSpy.mock.calls.filter((call) => call[0] === '/cumplimiento').length;
    screen.getByTestId('reintentar-cumplimiento').click();
    await screen.findByText('No cargó Cumplimiento');
    const despues = apiGetSpy.mock.calls.filter((call) => call[0] === '/cumplimiento').length;
    expect(despues).toBeGreaterThan(antes);
  });

  it('pinta filas, KPIs y badges cuando la API trae operación', async () => {
    const ahora = Date.now();
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path.startsWith('/offers/mine')) {
        return {
          offers: [
            { expires_at: new Date(ahora + 42 * 60_000).toISOString(), status: 'pendiente' },
          ],
        };
      }
      if (path === '/assignments') {
        return {
          assignments: [
            {
              status: 'recogido',
              driver: { user_id: 'd1' },
              trip: { pickup_window_start: null, origin: { address_raw: 'Origen' } },
            },
            {
              status: 'asignado',
              driver: null,
              trip: {
                pickup_window_start: new Date(ahora + 20 * 60 * 60_000).toISOString(),
                origin: { address_raw: 'Bodega norte, Quilicura' },
              },
            },
          ],
        };
      }
      if (path === '/cumplimiento') {
        return {
          resumen: { vencidos: 1, por_vencer_30d: 2, total_pendientes: 3 },
          vehiculos: [{ plate: 'KXJR42', tipo: 'soap', estado: 'vencido' }],
          conductores: [],
        };
      }
      if (path === '/vehiculos/flota') {
        return {
          fleet: [
            {
              plate: 'HFTD17',
              teltonika_imei: '1',
              position: {
                timestamp_device: new Date(ahora - 45 * 60_000).toISOString(),
                latitude: -33.4,
                longitude: -70.6,
              },
            },
          ],
        };
      }
      return respuestaVacia(path);
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByText('1 oferta nueva')).toBeInTheDocument();
    expect(screen.getAllByText('Sin conductor').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Quilicura/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 documento vencido').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+2 por vencer en 30 días/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('1 sin señal').length).toBeGreaterThan(0);
    expect(screen.getByText(/sin GPS/)).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-link-ofertas')).toHaveTextContent('1');
    expect(screen.getByTestId('dashboard-link-servicios')).toHaveTextContent('1');
    expect(screen.getByTestId('dashboard-link-cumplimiento')).toHaveTextContent('1');
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('un KPI caído no apaga el otro y la respuesta inválida es error de ese bloque', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path === '/assignments') {
        throw new Error('servicios caídos');
      }
      if (path === '/vehiculos/flota') {
        return { fleet: 'no' };
      }
      if (path === '/cumplimiento') {
        return { roto: true };
      }
      return respuestaVacia(path);
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect((await screen.findAllByText('No cargó Servicios')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('No cargó Flota').length).toBeGreaterThan(0);
    expect(screen.getByText('No cargó Cumplimiento')).toBeInTheDocument();
    expect(screen.getAllByText('El resto del Inicio sigue funcionando').length).toBeGreaterThan(0);
    screen.getByTestId('reintentar-servicios').click();
    expect((await screen.findAllByText('No cargó Servicios')).length).toBeGreaterThan(0);
  });

  it('sin empresa conserva el alta y no monta el inicio del transportista', () => {
    providedContext = {
      kind: 'onboarded',
      me: { ...makeMe(), active_membership: null },
    };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByRole('heading', { name: 'Bienvenido a Booster' })).toBeInTheDocument();
    expect(screen.getByText('Sin empresa activa.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Aún no tienes empresa' })).toBeInTheDocument();
    expect(screen.queryByTestId('inicio-transportista')).not.toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('empresa que todavía no opera conserva el aviso', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', false, false) };
    renderWithQueryClient(<AppRoute />);
    expect(screen.getByRole('heading', { name: 'Bienvenido a Booster' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Tu empresa todavía no opera' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('inicio-transportista')).not.toBeInTheDocument();
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('reintenta cuando no cargan vehículos o conductores', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path === '/vehiculos' || path === '/conductores') {
        throw new Error('lista caída');
      }
      return respuestaVacia(path);
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    renderWithQueryClient(<AppRoute />);
    expect(await screen.findByText('No cargó Vehículos')).toBeInTheDocument();
    expect(screen.getByText('No cargó Conductores')).toBeInTheDocument();
    const antes = apiGetSpy.mock.calls.filter((call) => call[0] === '/vehiculos').length;
    screen.getByTestId('reintentar-vehiculos').click();
    await screen.findByText('No cargó Vehículos');
    const despues = apiGetSpy.mock.calls.filter((call) => call[0] === '/vehiculos').length;
    expect(despues).toBeGreaterThan(antes);
  });
});
