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

  it('el aviso de hormiga es otro texto y también abre el mapa', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConRobo,
      total: 1,
      trayectos: [
        {
          ...listadoConRobo.trayectos[0],
          posible_robo_combustible: false,
          posible_robo_hormiga: true,
          event_lat: -33.41,
          event_lon: -70.61,
        },
      ],
    });
    const view = renderPage();
    expect(await screen.findByText('posible robo hormiga')).toBeInTheDocument();
    expect(screen.queryByText('posible robo combustible')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver en el mapa' })).toHaveAttribute(
      'href',
      '/app/trayectos?detalle=t-1',
    );
    routerState.search = { detalle: 't-1' };
    view.rerender(
      <QueryClientProvider client={view.client}>
        <TrayectosTeltonikaRoute />
      </QueryClientProvider>,
    );
    const mapa = await screen.findByTestId('mapa-evento');
    expect(mapa).toHaveAttribute('data-lat', '-33.41');
    expect(mapa).toHaveAttribute('data-lng', '-70.61');
    expect(screen.getByText('posible robo hormiga')).toBeInTheDocument();
    expect(screen.queryByText(/no tiene un aviso de posible robo/)).not.toBeInTheDocument();
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

const trayectoBase = listadoConRobo.trayectos[0];

const flotaMixta = [
  { vehiculo_id: 'v-1', patente: 'JLKT54', combustible: 'nivel_litros' },
  { vehiculo_id: 'v-2', patente: 'JWTH77', combustible: 'nivel_porcentaje' },
  { vehiculo_id: 'v-3', patente: 'KFKW23', combustible: 'consumo_can' },
  { vehiculo_id: 'v-4', patente: 'KZBB26', combustible: 'sin_sensor' },
  { vehiculo_id: 'v-5', patente: 'PLFL57', combustible: 'consumo_can' },
  { vehiculo_id: 'v-6', patente: 'RCPC20', combustible: 'consumo_can' },
  { vehiculo_id: 'v-7', patente: 'VFZH-68', combustible: 'sin_sensor' },
];

const listadoConDato = {
  ...listadoConRobo,
  combustible: 'con_dato',
  total: 2,
  total_con_combustible: 2,
  total_sin_combustible: 3,
  vehiculos: flotaMixta,
  trayectos: [
    {
      ...trayectoBase,
      id: 't-rcpc',
      vehiculo_id: 'v-6',
      patente: 'RCPC20',
      distancia_km: 348.9,
      litros_iniciales: null,
      litros_finales: null,
      km_por_litro: 2.54,
      fuente_combustible: 'consumo_can',
      litros_consumidos: 137.5,
      nivel_pct_inicial: 90,
      nivel_pct_final: 58,
      posible_robo_combustible: false,
      sensor_combustible: 'degradado',
    },
    {
      ...trayectoBase,
      id: 't-jwth',
      vehiculo_id: 'v-2',
      patente: 'JWTH77',
      distancia_km: 120,
      litros_iniciales: null,
      litros_finales: null,
      km_por_litro: null,
      fuente_combustible: 'nivel_porcentaje',
      litros_consumidos: null,
      nivel_pct_inicial: 77,
      nivel_pct_final: 52,
      posible_robo_combustible: false,
      sensor_combustible: 'degradado',
    },
  ],
};

const listadoSinDato = {
  ...listadoConDato,
  combustible: 'sin_dato',
  total: 2,
  trayectos: [
    {
      ...trayectoBase,
      id: 't-kzbb',
      vehiculo_id: 'v-4',
      patente: 'KZBB26',
      litros_iniciales: null,
      litros_finales: null,
      km_por_litro: null,
      fuente_combustible: null,
      litros_consumidos: null,
      nivel_pct_inicial: null,
      nivel_pct_final: null,
      nota_combustible: null,
      posible_robo_combustible: false,
      sensor_combustible: 'ausente',
      cta_sensor: true,
    },
    {
      ...trayectoBase,
      id: 't-plfl',
      vehiculo_id: 'v-5',
      patente: 'PLFL57',
      litros_iniciales: null,
      litros_finales: null,
      km_por_litro: null,
      fuente_combustible: null,
      litros_consumidos: null,
      nivel_pct_inicial: null,
      nivel_pct_final: null,
      nota_combustible: 'No hay una lectura válida de litros en este trayecto. No calculamos km/L.',
      posible_robo_combustible: false,
      sensor_combustible: 'degradado',
    },
  ],
};

describe('TrayectosTeltonikaRoute — fuentes CAN y vista limpia', () => {
  it('con litros consumidos del CAN muestra litros, km/L y el nivel en %', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(listadoConDato);
    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByText('RCPC20')).toBeInTheDocument();
    expect(screen.getByText('137,5 L')).toBeInTheDocument();
    expect(screen.getByText('2,54 km/L')).toBeInTheDocument();
    expect(screen.getByText('39,4 L/100 km')).toBeInTheDocument();
    expect(screen.getByText('90 %')).toBeInTheDocument();
    expect(screen.getByText('58 %')).toBeInTheDocument();
    expect(screen.getByText('77 %')).toBeInTheDocument();
    expect(screen.queryByText(/No hay una lectura válida/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Conectá el sensor de combustible/)).not.toBeInTheDocument();
  });

  it('explica una vez por causa qué informa cada camión, sin los que no tienen sensor', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(listadoConDato);
    renderPage();
    const leyenda = await screen.findByRole('region', { name: 'Qué informa cada camión' });
    expect(leyenda).toHaveTextContent(
      'JLKT54 informa el nivel del estanque en litros: ves litros, km/L y el aviso de posible robo.',
    );
    expect(leyenda).toHaveTextContent(
      'KFKW23, PLFL57 y RCPC20 informan los litros consumidos: ves litros y km/L. El aviso de posible robo necesita el nivel en litros.',
    );
    expect(leyenda).toHaveTextContent(
      'JWTH77 informa el nivel en %, no en litros: sin la capacidad del estanque no calculamos litros ni km/L.',
    );
    expect(leyenda).not.toHaveTextContent('KZBB26');
    expect(leyenda).not.toHaveTextContent('VFZH-68');
  });

  it('los trayectos sin dato van en otra pestaña, con un mensaje por causa', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockImplementation(async (url: string) =>
        url.includes('combustible=sin_dato') ? listadoSinDato : listadoConDato,
      );
    renderPage();
    expect(
      await screen.findByRole('button', { name: 'Con combustible (2)', pressed: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sin dato de combustible (3)' }));
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith(
        '/trayectos-teltonika?page=1&page_size=20&combustible=sin_dato',
      );
    });
    expect(
      await screen.findByText(
        'KZBB26 y VFZH-68 no tienen sensor de combustible conectado. Acá ves sus trayectos y kilómetros.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('En estos trayectos de PLFL57 no llegó lectura de combustible.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No hay una lectura válida/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Litros' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin dato de combustible (3)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('sin trayectos con combustible lo dice y deja ver la otra pestaña', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConDato,
      total: 0,
      total_con_combustible: 0,
      total_sin_combustible: 3,
      trayectos: [],
    });
    renderPage();
    expect(
      await screen.findByText('No hay trayectos con dato de combustible en este período.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sin dato de combustible (3)' })).toBeEnabled();
  });

  it('si la API no trae los totales, no muestra pestañas', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(listadoConRobo);
    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Con combustible/ })).not.toBeInTheDocument();
  });

  it('explica una sola vez por qué un tramo corto no tiene litros ni km/L', async () => {
    const corto = {
      ...listadoConDato.trayectos[0],
      distancia_km: 0.4,
      km_por_litro: null,
      litros_consumidos: null,
      nota_combustible: null,
    };
    vi.spyOn(api, 'get').mockResolvedValue({
      ...listadoConDato,
      trayectos: [
        { ...corto, id: 'c-1' },
        { ...corto, id: 'c-2' },
      ],
    });
    renderPage();
    expect(
      await screen.findAllByText(
        'Sin litros ni km/L en trayectos de menos de 10 km o 5 L: con tan poca muestra el número no es confiable.',
      ),
    ).toHaveLength(1);
  });

  it('sin tramos cortos no muestra esa aclaración', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(listadoConDato);
    renderPage();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(/con tan poca muestra/)).not.toBeInTheDocument();
  });
});
