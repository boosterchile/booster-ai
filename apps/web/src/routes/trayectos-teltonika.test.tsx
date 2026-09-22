import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Role = MeOnboarded['memberships'][number]['role'];

const estado = vi.hoisted(() => ({
  me: null as MeOnboarded | null,
}));

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({
    children,
  }: {
    children: (ctx: { kind: 'onboarded'; me: MeOnboarded }) => ReactNode;
  }) => <>{estado.me ? children({ kind: 'onboarded', me: estado.me }) : null}</>,
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const routerState = vi.hoisted(() => ({
  search: {} as { detalle?: string; page?: number },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
  }: {
    children: ReactNode;
    to: string;
    search?: { detalle?: string; page?: number };
  }) => {
    const params = new URLSearchParams();
    if (search?.detalle) {
      params.set('detalle', search.detalle);
    }
    if (search?.page != null) {
      params.set('page', String(search.page));
    }
    const qs = params.toString();
    return <a href={qs ? `${to}?${qs}` : to}>{children}</a>;
  },
  useSearch: () => routerState.search,
}));

vi.mock('../components/map/EventoCombustibleMap.js', () => ({
  EventoCombustibleMap: ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <div data-testid="mapa-evento" data-lat={String(latitude)} data-lng={String(longitude)} />
  ),
}));

const { TrayectosTeltonikaRoute } = await import('./trayectos-teltonika.js');

function meDe(role: Role, transportista: boolean): MeOnboarded {
  const membership = {
    id: 'm-1',
    role,
    status: 'activa' as const,
    joined_at: null,
    empresa: {
      id: 'e-1',
      legal_name: 'Transporte Sur',
      rut: '76.000.000-0',
      is_generador_carga: false,
      is_transportista: transportista,
      status: 'activa' as const,
    },
  };
  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'dueno@sur.cl',
      full_name: 'Ana Pérez',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [membership],
    active_membership: membership,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <TrayectosTeltonikaRoute />
      </QueryClientProvider>,
    ),
  };
}

const listadoConRobo = {
  empresa_id: 'e-1',
  vehiculos_teltonika: 1,
  truncado: false,
  cta: null,
  cta_sensor: false,
  page: 1,
  page_size: 20,
  total: 21,
  trayectos: [
    {
      id: 't-1',
      vehiculo_id: 'v-1',
      empresa_id: 'e-1',
      patente: 'ABCD12',
      inicio: '2026-09-02T15:00:00.000Z',
      fin: '2026-09-02T16:00:00.000Z',
      distancia_km: 42.5,
      litros_iniciales: 80,
      litros_finales: 70,
      km_por_litro: 4.25,
      nota_combustible: null,
      posible_robo_combustible: true,
      event_lat: null,
      event_lon: null,
      sensor_combustible: 'presente',
      cta_sensor: false,
    },
  ],
};

beforeEach(() => {
  estado.me = meDe('dueno', true);
  routerState.search = {};
  vi.restoreAllMocks();
});

describe('TrayectosTeltonikaRoute', () => {
  it('el conductor no ve el historial ni dispara la consulta', () => {
    estado.me = meDe('conductor', true);
    const get = vi.spyOn(api, 'get');
    renderPage();
    expect(
      screen.getByText('No tenés permiso para ver el historial de trayectos.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-evento')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ver en el mapa' })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('el despachador tampoco entra', () => {
    estado.me = meDe('despachador', true);
    renderPage();
    expect(screen.getByText(/No tenés permiso/)).toBeInTheDocument();
  });

  it('sin Teltonika muestra el vacío y el enlace para vincular', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresa_id: 'e-1',
      vehiculos_teltonika: 0,
      truncado: false,
      cta: 'vincular_teltonika',
      cta_sensor: false,
      page: 1,
      page_size: 20,
      total: 0,
      trayectos: [],
    });
    renderPage();
    expect(await screen.findByText(/Todavía no tenés un Teltonika/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vincular Teltonika' })).toHaveAttribute(
      'href',
      '/app/admin/dispositivos',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('muestra inicio, fin, distancia, vehículo, litros, km/L, L/100 km y el badge', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(listadoConRobo);
    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('ABCD12')).toBeInTheDocument();
    expect(screen.getByText('posible robo combustible')).toBeInTheDocument();
    expect(screen.getByText('80,0 L')).toBeInTheDocument();
    expect(screen.getByText('70,0 L')).toBeInTheDocument();
    expect(screen.getByText('4,25 km/L')).toBeInTheDocument();
    // 10 L / 42,5 km × 100 = 23,529… → un decimal
    expect(screen.getByText('23,5 L/100 km')).toBeInTheDocument();
    expect(screen.getByText(/armás el costo de operación por tu cuenta/)).toBeInTheDocument();
    expect(screen.queryByText(/CLP|\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('sin sensor muestra la CTA y no inventa km/L', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      cta_sensor: true,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          litros_iniciales: null,
          litros_finales: null,
          km_por_litro: null,
          nota_combustible: null,
          posible_robo_combustible: false,
          sensor_combustible: 'ausente',
          cta_sensor: true,
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/Conectá el sensor para ver litros/)).toBeInTheDocument();
    expect(screen.getAllByText(/costo de operación/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\d[\d.,]* L\/100 km/)).not.toBeInTheDocument();
    expect(screen.getByText('ABCD12')).toBeInTheDocument();
    expect(screen.queryByText('posible robo combustible')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('si el nivel no baja, muestra la raya y la nota', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          km_por_litro: null,
          nota_combustible: 'El nivel no bajó en este trayecto, así que no calculamos km/L.',
          posible_robo_combustible: false,
        },
      ],
    });
    renderPage();
    expect(await screen.findByText(/no calculamos km\/L/)).toBeInTheDocument();
  });

  it('si la consulta falla, pide reintentar', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('red'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Probá de nuevo/);
  });

  it('un 403 de la API también se lee como falta de permiso', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'rol_no_autorizado', null));
    renderPage();
    expect(await screen.findByText(/No tenés permiso/)).toBeInTheDocument();
  });

  it('con geo, el listado abre el mapa centrado en el pin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          event_lat: -33.4,
          event_lon: -70.6,
        },
      ],
    });
    const view = renderPage();
    const link = await screen.findByRole('link', { name: 'Ver en el mapa' });
    expect(link).toHaveAttribute('href', '/app/trayectos?detalle=t-1');
    routerState.search = { detalle: 't-1' };
    view.rerender(
      <QueryClientProvider client={view.client}>
        <TrayectosTeltonikaRoute />
      </QueryClientProvider>,
    );
    const mapa = await screen.findByTestId('mapa-evento');
    expect(mapa).toHaveAttribute('data-lat', '-33.4');
    expect(mapa).toHaveAttribute('data-lng', '-70.6');
    expect(screen.getByText('posible robo combustible')).toBeInTheDocument();
    expect(screen.queryByText('sin ubicación')).not.toBeInTheDocument();
  });

  it('con badge y sin geo, el detalle dice sin ubicación y no pone pin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...listadoConRobo, total: 1 });
    routerState.search = { detalle: 't-1' };
    renderPage();
    expect(await screen.findByText('posible robo combustible')).toBeInTheDocument();
    expect(screen.getByText('sin ubicación')).toBeInTheDocument();
    expect(screen.getByText(/no marcamos un pin/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-evento')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al historial' })).toHaveAttribute(
      'href',
      '/app/trayectos',
    );
  });

  it('abre el detalle en la página que vino en la URL', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      page: 2,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          event_lat: -33.4,
          event_lon: -70.6,
        },
      ],
    });
    routerState.search = { detalle: 't-1', page: 2 };
    renderPage();
    expect(await screen.findByTestId('mapa-evento')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/trayectos-teltonika?page=2&page_size=20');
    expect(screen.getByRole('link', { name: 'Volver al historial' })).toHaveAttribute(
      'href',
      '/app/trayectos?page=2',
    );
  });

  it('un detalle sin aviso no muestra pin ni «sin ubicación»', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          posible_robo_combustible: false,
        },
      ],
    });
    routerState.search = { detalle: 't-1' };
    renderPage();
    expect(
      await screen.findByText(/no tiene un aviso de posible robo de combustible/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-evento')).not.toBeInTheDocument();
    expect(screen.queryByText('sin ubicación')).not.toBeInTheDocument();
  });

  it('un detalle que no está en la página no inventa un pin', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ...listadoConRobo, total: 1 });
    routerState.search = { detalle: 'no-esta' };
    renderPage();
    expect(await screen.findByText(/No encontramos ese trayecto/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-evento')).not.toBeInTheDocument();
    expect(screen.queryByText('sin ubicación')).not.toBeInTheDocument();
  });

  it('en la página 2 el enlace al mapa conserva la página', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          event_lat: -33.4,
          event_lon: -70.6,
        },
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('link', { name: 'Ver en el mapa' })).toHaveAttribute(
      'href',
      '/app/trayectos?detalle=t-1&page=2',
    );
  });

  it('pagina hacia los trayectos más viejos', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(listadoConRobo);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Siguiente' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/trayectos-teltonika?page=2&page_size=20');
    });
  });
});
