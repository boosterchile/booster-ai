import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

/**
 * `/app/rutas` — la oficina arma la ruta de un camión (ruta-parada-servicio
 * parte 6, spec §4.2 y §4.5): agrupa cargas ya aceptadas, las quita y ordena
 * las paradas. Las reglas las decide el API; la pantalla las explica.
 */

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

let providedContext: { kind: string; me?: MeOnboarded } = { kind: 'unmanaged' };
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: unknown) => ReactNode }) =>
    children(providedContext),
}));
vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main data-testid="layout" data-title={title}>
      {children}
    </main>
  ),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiDelete = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...a: unknown[]) => apiGet(...a),
      post: (...a: unknown[]) => apiPost(...a),
      put: (...a: unknown[]) => apiPut(...a),
      delete: (...a: unknown[]) => apiDelete(...a),
    },
  };
});

const { ApiError } = await import('../lib/api-client.js');
const { RutasRoute } = await import('./rutas.js');

function makeMe(over: { role?: string; transportista?: boolean } = {}): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u1', email: 'jefa@x.cl', full_name: 'Jefa', rut: '11111111-1' },
    memberships: [],
    active_membership: {
      role: over.role ?? 'despachador',
      empresa: {
        id: 'e1',
        legal_name: 'Transportes X',
        is_transportista: over.transportista ?? true,
        is_generador_carga: false,
      },
    },
  } as unknown as MeOnboarded;
}

const parada = (
  id: string,
  orden: number,
  tipo: 'recogida' | 'entrega',
  codigo: string,
  over: Record<string, unknown> = {},
) => ({
  id,
  orden,
  tipo,
  resuelta_en: null,
  servicio: {
    asignacion_id: `asig-${codigo}`,
    viaje_id: `viaje-${codigo}`,
    codigo_seguimiento: codigo,
    cancelado: false,
    direccion: tipo === 'recogida' ? `Bodega ${codigo}` : `Cliente ${codigo}`,
    ventana: null,
    peso_kg: 1000,
    volumen_m3: null,
  },
  ...over,
});
const tramo = (desde: number, masa: number) => ({
  desde,
  hasta: desde + 1,
  masa_kg: masa,
  volumen_m3: null,
  vacio: masa === 0,
});
const resumen = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  estado: 'planificada',
  vehiculo: { id: 'v1', patente: 'ABCD12' },
  unidad_arrastre: null,
  conductor: { id: 'c1', nombre: 'Juan Pérez' },
  servicios: 1,
  paradas_pendientes: 2,
  creada_en: '2026-11-11T12:00:00Z',
  ...over,
});
const RUTA_A = {
  id: 'ruta-a',
  estado: 'planificada',
  vehiculo: { id: 'v1', patente: 'ABCD12' },
  unidad_arrastre: null,
  conductor: { id: 'c1', nombre: 'Juan Pérez' },
  capacidad: { kg: 5000, m3: null },
  paradas: [
    parada('p1', 0, 'recogida', 'BOO-AAA111'),
    parada('p2', 1, 'recogida', 'BOO-BBB222'),
    parada('p3', 2, 'entrega', 'BOO-BBB222'),
    parada('p4', 3, 'entrega', 'BOO-AAA111'),
  ],
  tramos: [tramo(0, 1000), tramo(1, 2000), tramo(2, 1000)],
  avisos: [],
};
const RUTA_B = {
  ...RUTA_A,
  id: 'ruta-b',
  paradas: [parada('p5', 0, 'recogida', 'BOO-CCC333'), parada('p6', 1, 'entrega', 'BOO-CCC333')],
  tramos: [tramo(0, 1000)],
};

/** GET por ruta: flags, lista y detalle. */
const FLOTA = [
  { id: 'v1', plate: 'ABCD12', unit_category: 'motriz', status: 'activo' },
  { id: 'v2', plate: 'WXYZ99', unit_category: 'motriz', status: 'activo' },
  { id: 'v3', plate: 'TALL01', unit_category: 'motriz', status: 'mantenimiento' },
  { id: 'r1', plate: 'REMO01', unit_category: 'arrastre', status: 'activo' },
];
const CONDUCTORES = [
  {
    id: 'cd1',
    user_id: 'c1',
    status: 'activo',
    user: { id: 'c1', full_name: 'Juan Pérez', rut: null, is_pending: false },
  },
  {
    id: 'cd2',
    user_id: 'c2',
    status: 'activo',
    user: { id: 'c2', full_name: 'Ana Rojas', rut: null, is_pending: true },
  },
  {
    id: 'cd3',
    user_id: 'c3',
    status: 'baja',
    user: { id: 'c3', full_name: 'Se Fue', rut: null, is_pending: false },
  },
];

function servir(
  opts: {
    activada?: boolean;
    rutas?: unknown[];
    detalle?: Record<string, unknown>;
    vehiculos?: unknown;
  } = {},
) {
  apiGet.mockImplementation(async (path: string) => {
    if (path === '/feature-flags') {
      return { rutas_api_activada: opts.activada ?? true };
    }
    if (path === '/vehiculos') {
      return opts.vehiculos ?? FLOTA;
    }
    if (path === '/conductores') {
      return { conductores: CONDUCTORES };
    }
    if (path.startsWith('/rutas?') || path === '/rutas') {
      return {
        rutas: opts.rutas ?? [
          resumen('ruta-a', { servicios: 2, paradas_pendientes: 4 }),
          resumen('ruta-b'),
        ],
      };
    }
    const id = path.replace('/rutas/', '');
    const ruta = (opts.detalle ?? { 'ruta-a': RUTA_A, 'ruta-b': RUTA_B })[id];
    if (!ruta) {
      throw new ApiError(404, 'ruta_not_found', null);
    }
    return { ruta };
  });
}

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RutasRoute />
    </QueryClientProvider>,
  );
}

async function abrir(codigoRuta = 'ABCD12 · 2 cargas') {
  renderRoute();
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(codigoRuta) }));
  return screen.findByRole('region', { name: 'Paradas de la ruta' });
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'onboarded', me: makeMe() };
  servir();
});

describe('/app/rutas', () => {
  it('con la función apagada lo dice y no consulta rutas', async () => {
    servir({ activada: false });
    renderRoute();
    expect(await screen.findByText(/todavía no está disponible/)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringMatching(/^\/rutas/), expect.anything());
  });

  it('una empresa que no es transportista ve el aviso', async () => {
    providedContext = { kind: 'onboarded', me: makeMe({ transportista: false }) };
    renderRoute();
    expect(await screen.findByText(/no opera como transportista/)).toBeInTheDocument();
  });

  it('una ruta con varias cargas muestra el total y la parte de cada una', async () => {
    servir({
      detalle: {
        'ruta-a': {
          ...RUTA_A,
          huella: {
            es_estimacion: true,
            presentacion: 'estimado',
            emisiones_kgco2e: '100.000',
            servicios: [
              {
                viaje_id: 'viaje-BOO-AAA111',
                codigo_seguimiento: 'BOO-AAA111',
                participacion_pct: '40.00',
                emisiones_kgco2e: '40.000',
              },
              {
                viaje_id: 'viaje-BOO-BBB222',
                codigo_seguimiento: 'BOO-BBB222',
                participacion_pct: '60.00',
                emisiones_kgco2e: '60.000',
              },
            ],
          },
        },
        'ruta-b': RUTA_B,
      },
    });
    await abrir();
    const huella = await screen.findByRole('region', { name: 'Huella de la ruta' });
    expect(huella).toHaveTextContent('Estimación');
    expect(huella).not.toHaveTextContent('Medida');
    expect(huella).toHaveTextContent('100,000 kg CO₂e');
    expect(huella).toHaveTextContent('BOO-AAA111');
    expect(huella).toHaveTextContent('40,00 %');
    expect(huella).toHaveTextContent('60,000 kg CO₂e');
  });

  it('una ruta cerrada con distancia de mapas no dice Medida', async () => {
    servir({
      detalle: {
        'ruta-a': {
          ...RUTA_A,
          huella: {
            es_estimacion: false,
            presentacion: 'estimado',
            emisiones_kgco2e: '98.000',
            servicios: [
              {
                viaje_id: 'viaje-BOO-AAA111',
                codigo_seguimiento: 'BOO-AAA111',
                participacion_pct: '40.00',
                emisiones_kgco2e: '39.200',
              },
            ],
          },
        },
      },
    });
    await abrir();
    const huella = await screen.findByRole('region', { name: 'Huella de la ruta' });
    expect(huella).toHaveTextContent('Estimado');
    expect(huella).not.toHaveTextContent('Medida');
    expect(huella).not.toHaveTextContent('Estimación');
  });

  it('lista las rutas con su camión, conductor y cargas', async () => {
    renderRoute();
    const a = await screen.findByRole('button', { name: /ABCD12 · 2 cargas/ });
    expect(a).toHaveTextContent('Juan Pérez');
    expect(a).toHaveTextContent('4 paradas pendientes');
    expect(screen.getByRole('button', { name: /ABCD12 · 1 carga$/ })).toBeInTheDocument();
  });

  it('sin rutas, lo explica', async () => {
    servir({ rutas: [] });
    renderRoute();
    expect(await screen.findByText('No tienes rutas activas')).toBeInTheDocument();
  });

  it('al abrir una ruta muestra las paradas en orden y el peso a bordo entre paradas', async () => {
    const region = await abrir();
    const items = within(region).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringMatching(/^1.*Recoger.*BOO-AAA111.*Bodega BOO-AAA111/),
      expect.stringMatching(/^2.*Recoger.*BOO-BBB222/),
      expect.stringMatching(/^3.*Entregar.*BOO-BBB222/),
      expect.stringMatching(/^4.*Entregar.*BOO-AAA111/),
    ]);
    expect(within(region).getByText('Capacidad: 5.000 kg')).toBeInTheDocument();
    expect(
      within(region)
        .getAllByText(/a bordo/)
        .map((e) => e.textContent),
    ).toEqual(['1.000 kg a bordo', '2.000 kg a bordo', '1.000 kg a bordo']);
  });

  it('un tramo sin carga a bordo dice que el camión va vacío', async () => {
    servir({
      detalle: { 'ruta-a': { ...RUTA_A, tramos: [tramo(0, 1000), tramo(1, 0), tramo(2, 1000)] } },
    });
    const region = await abrir();
    expect(within(region).getByText('Camión vacío')).toBeInTheDocument();
    expect(within(region).queryByText('0 kg a bordo')).toBeNull();
  });

  it('bajar una parada pide el orden nuevo por ids y muestra el resultado', async () => {
    const reordenada = {
      ...RUTA_A,
      paradas: [RUTA_A.paradas[1], RUTA_A.paradas[0], RUTA_A.paradas[2], RUTA_A.paradas[3]],
    };
    apiPut.mockResolvedValue({ ruta: reordenada });
    const region = await abrir();
    await userEvent.click(
      within(region).getByRole('button', { name: 'Bajar la parada 1: recoger BOO-AAA111' }),
    );
    expect(apiPut).toHaveBeenCalledWith(
      '/rutas/ruta-a/paradas',
      { paradas: ['p2', 'p1', 'p3', 'p4'] },
      expect.anything(),
    );
    await waitFor(() =>
      expect(within(region).getAllByRole('listitem')[0]).toHaveTextContent('BOO-BBB222'),
    );
  });

  it('la primera no sube, la última no baja y una parada hecha no se mueve', async () => {
    servir({
      detalle: {
        'ruta-a': {
          ...RUTA_A,
          estado: 'en_curso',
          paradas: [
            parada('p1', 0, 'recogida', 'BOO-AAA111', { resuelta_en: '2026-11-12T13:00:00Z' }),
            ...RUTA_A.paradas.slice(1),
          ],
        },
      },
    });
    const region = await abrir();
    expect(within(region).queryByRole('button', { name: /la parada 1:/ })).toBeNull();
    expect(within(region).getByRole('button', { name: /Subir la parada 2:/ })).toBeDisabled();
    expect(within(region).getByRole('button', { name: /Bajar la parada 4:/ })).toBeDisabled();
    expect(within(region).getAllByRole('listitem')[0]).toHaveTextContent('Hecha');
  });

  it('quitar una carga la devuelve a su propia ruta y avisa', async () => {
    apiDelete.mockResolvedValue({ ruta: RUTA_B, ruta_nueva_id: 'ruta-nueva' });
    const region = await abrir();
    await userEvent.click(
      within(region).getByRole('button', { name: 'Quitar BOO-BBB222 de la ruta' }),
    );
    expect(apiDelete).toHaveBeenCalledWith(
      '/rutas/ruta-a/servicios/asig-BOO-BBB222',
      expect.anything(),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'BOO-BBB222 volvió a una ruta propia.',
    );
  });

  it('agregar una carga la pone al final de la ruta', async () => {
    apiPost.mockResolvedValue({ ruta: RUTA_A });
    await abrir();
    const otras = await screen.findByRole('region', { name: 'Cargas para agregar' });
    await userEvent.click(
      within(otras).getByRole('button', { name: 'Agregar BOO-CCC333 a la ruta' }),
    );
    expect(apiPost).toHaveBeenCalledWith(
      '/rutas/ruta-a/servicios',
      { asignacion_id: 'asig-BOO-CCC333', posicion: { recogida: 4, entrega: 5 } },
      expect.anything(),
    );
  });

  it('un rechazo por peso se explica con las cifras', async () => {
    apiPost.mockRejectedValue(
      new ApiError(422, 'ruta_invalida', {
        code: 'ruta_invalida',
        violaciones: [
          { motivo: 'capacidad_peso_excedida', tramo: 1, masa_kg: 6000, capacidad_kg: 5000 },
        ],
      }),
    );
    await abrir();
    const otras = await screen.findByRole('region', { name: 'Cargas para agregar' });
    await userEvent.click(within(otras).getByRole('button', { name: /Agregar BOO-CCC333/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No cabe: entre las paradas 2 y 3 irían 6.000 kg y el camión lleva 5.000 kg.',
    );
  });

  it.each([
    ['servicio_ya_recogido', 'Esa carga ya se recogió'],
    ['entrega_antes_de_recogida', 'La entrega de una carga no puede ir antes de su recogida'],
    ['parada_resuelta_movida', 'Una parada ya hecha no se puede mover'],
    ['recogida_antes_de_parada_resuelta', 'ya hechas'],
    ['servicio_sin_peso_en_ruta_consolidada', 'sin peso declarado'],
    ['carroceria_incompatible', 'carrocería'],
    ['motivo_que_no_existe', 'No se pudo hacer el cambio'],
  ])('rechazo %s → mensaje para la oficina', async (motivo, texto) => {
    apiPut.mockRejectedValue(new ApiError(422, 'ruta_invalida', { violaciones: [{ motivo }] }));
    const region = await abrir();
    await userEvent.click(within(region).getByRole('button', { name: /Bajar la parada 1:/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
  });

  it('un error que no es de reglas pide reintentar', async () => {
    apiPut.mockRejectedValue(new Error('red'));
    const region = await abrir();
    await userEvent.click(within(region).getByRole('button', { name: /Bajar la parada 1:/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Intenta de nuevo');
  });

  it('quien solo mira no tiene botones para cambiar la ruta', async () => {
    providedContext = { kind: 'onboarded', me: makeMe({ role: 'visualizador' }) };
    const region = await abrir();
    expect(within(region).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Bajar|Subir|Quitar|Agregar/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Cargas para agregar' })).toBeNull();
  });

  it('una carga cancelada se muestra tachada y sin acciones', async () => {
    servir({
      detalle: {
        'ruta-a': {
          ...RUTA_A,
          paradas: RUTA_A.paradas.map((p) =>
            p.servicio.codigo_seguimiento === 'BOO-BBB222'
              ? { ...p, servicio: { ...p.servicio, cancelado: true } }
              : p,
          ),
        },
      },
    });
    const region = await abrir();
    expect(within(region).getAllByRole('listitem')[1]).toHaveTextContent('Cancelada');
    expect(within(region).queryByRole('button', { name: /BOO-BBB222/ })).toBeNull();
  });

  // Parte 6d: declarar camión, arrastre y conductor desde la ruta.
  describe('camión y conductor', () => {
    const form = async () => {
      await abrir();
      return screen.findByRole('group', { name: 'Camión y conductor' });
    };

    it('muestra lo declarado y ofrece solo unidades activas y conductores vigentes', async () => {
      const f = await form();
      const camion = within(f).getByLabelText('Camión');
      expect(camion).toHaveValue('v1');
      expect(
        within(camion)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['ABCD12', 'WXYZ99']);
      expect(
        within(within(f).getByLabelText('Arrastre'))
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Sin arrastre', 'REMO01']);
      const conductor = within(f).getByLabelText('Conductor');
      expect(conductor).toHaveValue('c1');
      expect(
        within(conductor)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Sin conductor', 'Juan Pérez', 'Ana Rojas (sin activar)']);
      expect(within(f).getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('guardar declara los tres en la ruta', async () => {
      apiPut.mockResolvedValue({
        ruta: {
          ...RUTA_A,
          vehiculo: { id: 'v2', patente: 'WXYZ99' },
          unidad_arrastre: { id: 'r1', patente: 'REMO01' },
          conductor: { id: 'c2', nombre: 'Ana Rojas' },
        },
      });
      const f = await form();
      await userEvent.selectOptions(within(f).getByLabelText('Camión'), 'v2');
      await userEvent.selectOptions(within(f).getByLabelText('Arrastre'), 'r1');
      await userEvent.selectOptions(within(f).getByLabelText('Conductor'), 'c2');
      await userEvent.click(within(f).getByRole('button', { name: 'Guardar' }));
      expect(apiPut).toHaveBeenCalledWith(
        '/rutas/ruta-a/configuracion',
        { vehiculo_id: 'v2', unidad_arrastre_id: 'r1', conductor_id: 'c2' },
        expect.anything(),
      );
      expect(await screen.findByRole('status')).toHaveTextContent('Camión y conductor guardados.');
      // El formulario vuelve a partir de lo que quedó guardado.
      await waitFor(() =>
        expect(
          within(screen.getByRole('group', { name: 'Camión y conductor' })).getByLabelText(
            'Camión',
          ),
        ).toHaveValue('v2'),
      );
      expect(
        within(screen.getByRole('group', { name: 'Camión y conductor' })).getByRole('button', {
          name: 'Guardar',
        }),
      ).toBeDisabled();
    });

    it('con una carga recogida solo se cambia el conductor', async () => {
      servir({
        detalle: {
          'ruta-a': {
            ...RUTA_A,
            estado: 'en_curso',
            paradas: [
              parada('p1', 0, 'recogida', 'BOO-AAA111', { resuelta_en: '2026-11-12T13:00:00Z' }),
              ...RUTA_A.paradas.slice(1),
            ],
          },
        },
      });
      const f = await form();
      expect(within(f).getByLabelText('Camión')).toBeDisabled();
      expect(within(f).getByLabelText('Arrastre')).toBeDisabled();
      expect(within(f).getByLabelText('Conductor')).toBeEnabled();
      expect(within(f).getByText(/ya hay carga recogida/)).toBeInTheDocument();
      // En curso no se ofrece dejar la ruta sin conductor.
      expect(
        within(within(f).getByLabelText('Conductor')).queryByRole('option', {
          name: 'Sin conductor',
        }),
      ).toBeNull();
    });

    it.each([
      [
        {
          code: 'vehiculo_no_asignable',
          unidad: 'unidad_arrastre',
          motivo: 'no_compone_con_la_motriz',
        },
        'Ese arrastre no se engancha a ese camión',
      ],
      [
        { code: 'vehiculo_no_asignable', unidad: 'vehiculo', motivo: 'no_esta_activa' },
        'no está activo',
      ],
      [{ code: 'conductor_no_asignable' }, 'Ese conductor ya no está disponible'],
      [
        { code: 'ruta_invalida', violaciones: [{ motivo: 'vehiculo_con_carga_recogida' }] },
        'ya hay carga recogida',
      ],
      [
        {
          code: 'ruta_invalida',
          violaciones: [
            { motivo: 'capacidad_peso_excedida', tramo: 1, masa_kg: 2000, capacidad_kg: 1500 },
          ],
        },
        'irían 2.000 kg y el camión lleva 1.500 kg',
      ],
    ])('rechazo %j → mensaje', async (cuerpo, texto) => {
      apiPut.mockRejectedValue(new ApiError(422, cuerpo.code, cuerpo));
      const f = await form();
      await userEvent.selectOptions(within(f).getByLabelText('Camión'), 'v2');
      await userEvent.click(within(f).getByRole('button', { name: 'Guardar' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    });

    it('quien solo mira ve el camión y el conductor, sin formulario', async () => {
      providedContext = { kind: 'onboarded', me: makeMe({ role: 'visualizador' }) };
      await abrir();
      expect(screen.queryByRole('group', { name: 'Camión y conductor' })).toBeNull();
      expect(screen.getByText('Camión ABCD12 · Conductor Juan Pérez')).toBeInTheDocument();
    });

    it('si la flota no carga, lo dice y no deja guardar', async () => {
      servir({ vehiculos: { raro: true } });
      const f = await form();
      expect(await within(f).findByText(/No pudimos cargar tu flota/)).toBeInTheDocument();
      expect(within(f).getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });
  });
});
