import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { posicionEnVentana, tramosDeNivel } from '../components/booster-fleet/semana-vehiculo.js';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };
let idDeRuta = '11111111-1111-4111-8111-111111111111';

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    const ruta = Object.entries(params ?? {}).reduce(
      (acumulado, [clave, valor]) => acumulado.replace(`$${clave}`, valor),
      to,
    );
    const consulta = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={consulta ? `${ruta}?${consulta}` : ruta} {...props}>
        {children}
      </a>
    );
  },
  useParams: () => ({ id: idDeRuta }),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/map/EventoCombustibleMap.js', () => ({
  EventoCombustibleMap: ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <div data-testid="mapa-evento">
      {latitude},{longitude}
    </div>
  ),
}));

const { BoosterFleetVehiculoRoute } = await import('./booster-fleet-vehiculo.js');

const VEHICULO = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const DESDE = '2026-11-10T15:00:00.000Z';
const HASTA = '2026-11-17T15:00:00.000Z';

function me(rol: 'dueno' | 'despachador' = 'dueno'): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Dueño' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: rol,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Transportes Demo',
        rut: '76.123.456-7',
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    },
  } as MeOnboarded;
}

function panel(): PanelBoosterFleet {
  return {
    configuracion: {
      slug: 'booster-fleet',
      nombre: 'Booster Fleet',
      servicio: 'gestion_de_flota',
      audiencia: 'dueno_transportista',
      ventana_combustible_dias: 7,
    },
    combustible: {
      desde: DESDE,
      hasta: HASTA,
      truncado: false,
      litros: 412,
      km: 1067,
      litros_por_100_km: 38.6,
      con_alerta: 1,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          senal: 'posible_robo',
          litros: 412,
          km: 1067,
          litros_por_100_km: 38.6,
          alertas: ['golpe'],
          desviacion: {
            trayecto_id: 'trayecto-2',
            inicio: '2026-11-12T21:00:00.000Z',
            fin: '2026-11-13T10:00:00.000Z',
            tipo: 'golpe',
            desde: '2026-11-13T06:12:00.000Z',
            hasta: '2026-11-13T06:16:00.000Z',
            litros: 62,
            lat: -34.98,
            lon: -71.23,
            total: 1,
          },
        },
        {
          vehiculo_id: OTRO,
          patente: 'BBBB22',
          senal: 'en_orden',
          litros: 300,
          km: 1000,
          litros_por_100_km: 30,
          alertas: [],
        },
      ],
    },
    documental: {
      vehiculos_al_dia: 1,
      vehiculos_con_hallazgo: 1,
      conductores_al_dia: 0,
      conductores_con_hallazgo: 0,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          al_dia: false,
          estado: 'vencido',
          documentos: [
            {
              tipo: 'revision_tecnica',
              estado: 'vencido',
              fecha_vencimiento: '2026-11-02',
              archivo: true,
            },
            { tipo: 'soap', estado: 'vigente', fecha_vencimiento: '2027-03-31', archivo: true },
          ],
        },
      ],
      conductores: [],
    },
    mantenciones: {
      vencidas: 0,
      proximas: 0,
      programadas: 0,
      truncadas: false,
      en_taller: [],
      items: [],
    },
  };
}

function trayectos() {
  return {
    trayectos: [
      {
        id: 'trayecto-2',
        inicio: '2026-11-12T21:00:00.000Z',
        fin: '2026-11-13T10:00:00.000Z',
        distancia_km: 196,
        litros_iniciales: 360,
        litros_finales: 108,
        litros_consumidos: 88,
        litros_por_100_km: 44.9,
        nivel_pct_inicial: 90,
        nivel_pct_final: 27,
        posible_robo_combustible: true,
        posible_robo_hormiga: false,
        evento_desde: '2026-11-13T06:12:00.000Z',
        evento_hasta: '2026-11-13T06:16:00.000Z',
        evento_litros: 62,
      },
      {
        id: 'trayecto-1',
        inicio: '2026-11-10T16:00:00.000Z',
        fin: '2026-11-10T20:00:00.000Z',
        distancia_km: 255,
        litros_iniciales: 328,
        litros_finales: 232,
        litros_consumidos: 96,
        litros_por_100_km: 37.6,
        nivel_pct_inicial: 82,
        nivel_pct_final: 58,
        posible_robo_combustible: false,
      },
    ],
  };
}

function entrar(datos: PanelBoosterFleet = panel(), lista: unknown = trayectos()) {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith('/trayectos-teltonika')) {
      return lista as never;
    }
    return datos as never;
  });
  providedContext = { kind: 'onboarded', me: me() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const vista = render(
    <QueryClientProvider client={client}>
      <BoosterFleetVehiculoRoute />
    </QueryClientProvider>,
  );
  return { ...vista, get };
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
  idDeRuta = VEHICULO;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BoosterFleetVehiculoRoute', () => {
  it('sin sesión no muestra nada y un despachador no ve el detalle', () => {
    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <BoosterFleetVehiculoRoute />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Booster Fleet')).not.toBeInTheDocument();
    const get = vi.spyOn(api, 'get');
    providedContext = { kind: 'onboarded', me: me('despachador') };
    rerender(
      <QueryClientProvider client={client}>
        <BoosterFleetVehiculoRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByText(/control de flota del dueño/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('la desviación muestra fecha, hora, litros, coordenadas y el mapa', async () => {
    const { container, get } = entrar();
    expect(
      await screen.findByRole('heading', { name: 'Desviación de combustible por analizar' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AAAA11');
    const bloque = within(
      screen.getByRole('region', { name: 'Desviación de combustible por analizar' }),
    );
    expect(bloque.getByText('vie 13 nov')).toBeInTheDocument();
    expect(bloque.getByText('03:12 a 03:16')).toBeInTheDocument();
    expect(bloque.getByText('-34.9800, -71.2300')).toBeInTheDocument();
    expect(bloque.getByText('−62,0 L')).toBeInTheDocument();
    expect(screen.getByTestId('mapa-evento')).toHaveTextContent('-34.98,-71.23');
    expect(screen.getByRole('link', { name: 'Analizar trayecto' })).toHaveAttribute(
      'href',
      `/app/trayectos?vehiculo=${VEHICULO}&detalle=trayecto-2`,
    );
    expect(screen.getByText(/Puede ser una falla del sensor/)).toBeInTheDocument();
    expect(screen.getByText(/puede venir de la vía/)).toBeInTheDocument();
    await screen.findByText('2 trayectos');
    const url = String(get.mock.calls.find((c) => String(c[0]).startsWith('/trayectos'))?.[0]);
    expect(url).toContain(`vehiculo_id=${VEHICULO}`);
    expect(url).toContain(`desde=${encodeURIComponent(DESDE)}`);
    expect(container.textContent ?? '').not.toMatch(/robo/i);
  });

  it('sin coordenadas dice «lugar sin dato» y no muestra un mapa vacío', async () => {
    const datos = panel();
    const desviacion = datos.combustible.vehiculos[0]?.desviacion;
    if (desviacion) {
      desviacion.lat = null;
      desviacion.lon = null;
      desviacion.desde = null;
      desviacion.hasta = null;
      desviacion.litros = null;
      desviacion.tipo = 'hormiga';
      desviacion.total = 2;
    }
    entrar(datos);
    expect(
      await screen.findByRole('heading', {
        name: 'Desviación gradual de combustible por analizar',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lugar sin dato')).toBeInTheDocument();
    expect(screen.getByText('Hora sin dato')).toBeInTheDocument();
    expect(screen.getByText('Fecha sin dato')).toBeInTheDocument();
    expect(screen.getByText('Litros sin dato')).toBeInTheDocument();
    expect(screen.getByText(/Hubo 2 desviaciones en la semana/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa-evento')).not.toBeInTheDocument();
  });

  it('la semana ubica cada trayecto en su día y marca el de la desviación', async () => {
    entrar();
    expect(await screen.findByRole('heading', { name: 'La semana de AAAA11' })).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /Nivel de estanque en 2 trayectos con lectura/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/03:16 · −62,0 L/)).toBeInTheDocument();
    const filas = screen.getAllByRole('row');
    expect(filas[1]).toHaveTextContent('mar 10 nov, 13:00');
    expect(filas[2]).toHaveTextContent('Desviación · −62,0 L');
    expect(filas[2]).toHaveTextContent('44,9');
  });

  it('un camión sin desviación ni trayectos lo dice y no dibuja nivel', async () => {
    idDeRuta = OTRO;
    entrar(panel(), { trayectos: [] });
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('BBBB22');
    expect(screen.queryByText(/por analizar/)).not.toBeInTheDocument();
    expect(await screen.findByText('Sin trayectos en la semana.')).toBeInTheDocument();
    expect(screen.getByText('Sin lectura de nivel en la semana.')).toBeInTheDocument();
    expect(screen.getByText('Sin desviaciones en la semana.')).toBeInTheDocument();
    expect(screen.getByText('Sin documentos pendientes.')).toBeInTheDocument();
    expect(screen.getByText('Taller en silencio.')).toBeInTheDocument();
  });

  it('muestra los documentos pendientes del vehículo y deja programar una inspección', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ mantencion: {} });
    const user = userEvent.setup();
    entrar();
    expect(await screen.findByText('Revisión técnica')).toBeInTheDocument();
    expect(screen.getByText(/Vencido · 2 nov/)).toBeInTheDocument();
    expect(screen.queryByText('SOAP')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Programar inspección' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Programar inspección' });
    const campo = dialogo.querySelector('input[name="titulo"]');
    expect(campo).not.toBeNull();
    await user.type(campo as HTMLInputElement, 'Inspección del estanque');
    await user.click(dialogo.querySelector('button[type="submit"]') as HTMLButtonElement);
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      vehiculo_id: VEHICULO,
      titulo: 'Inspección del estanque',
    });
  });

  it('un vehículo que no es de la flota y los errores se dicen', async () => {
    idDeRuta = '99999999-9999-4999-8999-999999999999';
    const { unmount } = entrar();
    expect(await screen.findByText('Este vehículo no está en la flota.')).toBeInTheDocument();
    unmount();

    idDeRuta = VEHICULO;
    entrar(panel(), { no: 'es' });
    expect(
      await screen.findByText('La respuesta de trayectos no tiene la forma esperada.'),
    ).toBeInTheDocument();
  });

  it('si el panel falla, muestra el error', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('falló el panel'));
    providedContext = { kind: 'onboarded', me: me() };
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <BoosterFleetVehiculoRoute />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('falló el panel')).toBeInTheDocument();
  });

  it('el detalle no tiene violaciones de accesibilidad', async () => {
    const { container } = entrar();
    await screen.findByText('2 trayectos');
    const resultado = await axe(container);
    expect(resultado.violations).toEqual([]);
  });
});

describe('eje de tiempo', () => {
  const desde = Date.parse(DESDE);
  const hasta = Date.parse(HASTA);

  it('ubica un instante dentro de la ventana y lo acota a sus bordes', () => {
    expect(posicionEnVentana('2026-11-14T03:00:00.000Z', desde, hasta)).toBe(50);
    expect(posicionEnVentana('2026-11-01T00:00:00.000Z', desde, hasta)).toBe(0);
    expect(posicionEnVentana('2026-12-01T00:00:00.000Z', desde, hasta)).toBe(100);
    expect(posicionEnVentana('no es fecha', desde, hasta)).toBeNull();
    expect(posicionEnVentana(DESDE, hasta, desde)).toBeNull();
  });

  it('dibuja un tramo por trayecto con lectura y no une trayectos', () => {
    const base = { desviacion: false, litros_iniciales: null, litros_finales: null };
    const nivel = tramosDeNivel(
      [
        {
          ...base,
          id: 'a',
          inicio: DESDE,
          fin: '2026-11-11T15:00:00.000Z',
          nivel_pct_inicial: 80,
          nivel_pct_final: 60,
        },
        { ...base, id: 'b', inicio: '2026-11-12T15:00:00.000Z', fin: '2026-11-13T15:00:00.000Z' },
      ],
      desde,
      hasta,
    );
    expect(nivel.unidad).toBe('%');
    expect(nivel.tramos).toHaveLength(1);
    expect(nivel.tramos[0]).toMatchObject({ id: 'a', x1: 0, y1: 20, y2: 40 });
  });

  it('sin porcentaje usa los litros contra el máximo de la semana', () => {
    const nivel = tramosDeNivel(
      [
        {
          id: 'a',
          inicio: DESDE,
          fin: HASTA,
          litros_iniciales: 400,
          litros_finales: 100,
          desviacion: false,
        },
      ],
      desde,
      hasta,
    );
    expect(nivel).toMatchObject({ unidad: 'L', tope: 400 });
    expect(nivel.tramos[0]).toMatchObject({ y1: 0, y2: 75 });
    expect(tramosDeNivel([], desde, hasta).tramos).toEqual([]);
  });
});
