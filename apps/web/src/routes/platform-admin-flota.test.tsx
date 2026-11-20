import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FichaDeVehiculo, VehiculoDeFlota } from '../components/admin/FlotaPlataforma.js';
import { api } from '../lib/api-client.js';

/**
 * `.specs/flota-plataforma` — `/app/platform-admin/flota`: el mapa, la lista
 * con búsqueda y filtro por empresa, y la ficha del vehículo seleccionado.
 */
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: { kind: 'unmanaged' }) => ReactNode }) => (
    <>{children({ kind: 'unmanaged' })}</>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));
vi.mock('../hooks/use-me.js', () => ({ useMe: () => ({ data: undefined }) }));
// El mapa real necesita Google Maps: aquí es un botón por vehículo con posición.
vi.mock('../components/map/FleetMap.js', () => ({
  FleetMap: ({
    vehicles,
    selectedId,
    onSelectVehicle,
  }: {
    vehicles: { id: string; plate: string }[];
    selectedId: string | null;
    onSelectVehicle: (id: string) => void;
  }) => (
    <div data-testid="mapa" data-seleccion={selectedId ?? ''}>
      {vehicles.map((v) => (
        <button key={v.id} type="button" onClick={() => onSelectVehicle(v.id)}>
          marcador {v.plate}
        </button>
      ))}
    </div>
  ),
}));

const { PlatformAdminFlotaRoute } = await import('./platform-admin-flota.js');

const vehiculo = (extra: Partial<VehiculoDeFlota>): VehiculoDeFlota => ({
  id: 'v-1',
  patente: 'KZXB64',
  empresa: { id: 'e-1', nombre: 'Transportes Andes Ltda.' },
  tipo: 'camion_pesado',
  capacidad_kg: 28000,
  estado: 'activo',
  teltonika_imei: '861234567890123',
  fuente_combustible_can: '83',
  posicion: {
    latitud: -33.45,
    longitud: -70.66,
    velocidad_kmh: 62,
    registrada_en: new Date().toISOString(),
    fuente: 'teltonika',
  },
  ...extra,
});
const FLOTA = [
  vehiculo({}),
  vehiculo({ id: 'v-2', patente: 'KFKW23', fuente_combustible_can: 'sin_sensor' }),
  vehiculo({
    id: 'v-3',
    patente: 'ABCD12',
    empresa: { id: 'e-2', nombre: 'Logística Biobío SpA' },
    teltonika_imei: null,
    estado: 'mantenimiento',
    posicion: null,
  }),
];
const FICHA: FichaDeVehiculo = {
  vehiculo: {
    id: 'v-2',
    patente: 'KFKW23',
    empresa: { id: 'e-1', nombre: 'Transportes Andes Ltda.', rut: '77.111.222-3' },
    tipo: 'camion_pesado',
    marca: 'Scania',
    modelo: 'R450',
    anio: 2021,
    combustible: 'diesel',
    capacidad_kg: 28000,
    peso_vacio_kg: 9000,
    consumo_l_por_100km_base: 32,
    capacidad_estanque_l: 400,
    estado: 'activo',
    teltonika_imei: '861234567890123',
    teltonika_imei_espejo: null,
  },
  can: {
    fuente_configurada: 'sin_sensor',
    ventana_dias: 3,
    puntos: 9832,
    con_combustible_83: 9808,
    con_nivel_84: 0,
    con_nivel_89: 9808,
    ultima_lectura_en: new Date().toISOString(),
    aviso: null,
  },
  viajes: {
    entregados: 2,
    en_curso: 1,
    certificados: {
      primario_verificable: 0,
      secundario_modeled: 1,
      secundario_default: 0,
      sin_certificado: 1,
      por_presentacion: { primario: 0, medido_teltonika: 1, estimado: 0 },
    },
    ultimos: [
      {
        codigo_seguimiento: 'BOO-AAA111',
        estado: 'recogido',
        entregado_en: null,
        nivel_certificacion: null,
        certificado_emitido: false,
        presentacion_certificado: null,
      },
      {
        codigo_seguimiento: 'BOO-BBB222',
        estado: 'entregado',
        entregado_en: '2026-10-20T18:00:00Z',
        nivel_certificacion: 'secundario_modeled',
        certificado_emitido: true,
        presentacion_certificado: 'medido_teltonika',
      },
      {
        codigo_seguimiento: 'BOO-CCC333',
        estado: 'entregado',
        entregado_en: '2026-10-22T18:00:00Z',
        nivel_certificacion: 'secundario_modeled',
        certificado_emitido: false,
        presentacion_certificado: null,
      },
    ],
  },
};

function montar(respuestas: { flota?: unknown; ficha?: unknown; falla?: 'flota' | 'ficha' } = {}) {
  vi.spyOn(api, 'get').mockImplementation(async (ruta: string) => {
    if (ruta === '/admin/plataforma/flota') {
      if (respuestas.falla === 'flota') {
        throw new Error('sin red');
      }
      return (respuestas.flota ?? { vehiculos: FLOTA }) as never;
    }
    if (respuestas.falla === 'ficha') {
      throw new Error('sin red');
    }
    return (respuestas.ficha ?? FICHA) as never;
  });
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <PlatformAdminFlotaRoute />
    </QueryClientProvider>,
  );
}
const filas = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('/app/platform-admin/flota', () => {
  it('muestra los vehículos de todas las empresas, en el mapa los que tienen posición', async () => {
    montar();
    await screen.findByRole('table');

    expect(filas()).toHaveLength(3);
    expect(screen.getByTestId('flota-resumen')).toHaveTextContent('3 vehículos · 2 con posición');
    expect(screen.getByRole('button', { name: 'marcador KZXB64' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'marcador ABCD12' })).not.toBeInTheDocument();
    const sinPosicion = filas()[2];
    expect(sinPosicion).toHaveTextContent('Logística Biobío SpA');
    expect(sinPosicion).toHaveTextContent('Mantenimiento');
    expect(sinPosicion).toHaveTextContent('Sin posición');
  });

  it('busca por patente o por empresa', async () => {
    montar();
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'kfk' } });
    expect(filas()).toHaveLength(1);
    expect(screen.getByTestId('flota-resumen')).toHaveTextContent('1 vehículo · 1 con posición');

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'biobío' } });
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toHaveTextContent('Logística Biobío SpA');

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'zzz' } });
    expect(screen.getByText('Ningún vehículo coincide con el filtro.')).toBeInTheDocument();
  });

  it('filtra por empresa, y el mapa sigue al filtro', async () => {
    montar();
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: 'e-2' } });

    expect(filas()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /^marcador/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Empresa'), { target: { value: '' } });
    expect(filas()).toHaveLength(3);
  });

  it('al seleccionar en la lista muestra la ficha, con el aviso de CAN sin configurar', async () => {
    montar();
    await screen.findByRole('table');
    expect(screen.getByText(/Selecciona un vehículo en el mapa o en la lista/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ver la ficha de KFKW23' }));

    const ficha = await screen.findByTestId('ficha-vehiculo');
    expect(api.get).toHaveBeenCalledWith('/admin/plataforma/flota/v-2');
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccion', 'v-2');
    expect(ficha).toHaveTextContent('77.111.222-3');
    expect(ficha).toHaveTextContent('Scania R450 2021');
    expect(ficha).toHaveTextContent('32 L/100 km');
    expect(ficha).toHaveTextContent('Equipo Teltonika');
    // El equipo envía el 83 sin estar marcado: la huella lo lee igual, no hay aviso.
    expect(within(ficha).queryByTestId('aviso-can')).not.toBeInTheDocument();
    expect(within(ficha).getByTestId('combustible-huella')).toHaveTextContent('Medido por CAN');
    expect(ficha).toHaveTextContent('Sin configurar');
    expect(ficha).toHaveTextContent('9.832 registros');
    expect(ficha).toHaveTextContent('BOO-AAA111');
    expect(ficha).toHaveTextContent('En camino');
    expect(ficha).toHaveTextContent('Certificado: distancia medida con Teltonika');
    expect(ficha).not.toHaveTextContent('Estimado (modelado)');
    expect(within(ficha).getByTestId('cert-primario')).toHaveTextContent('0');
    expect(within(ficha).getByTestId('cert-medido-teltonika')).toHaveTextContent('1');
    expect(within(ficha).getByTestId('cert-estimado')).toHaveTextContent('0');
    expect(ficha).toHaveTextContent('Sin certificado emitido');
  });

  it('al seleccionar un marcador del mapa también muestra la ficha', async () => {
    montar();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'marcador KFKW23' }));
    expect(await screen.findByTestId('ficha-vehiculo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver la ficha de KFKW23' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('la ficha de un vehículo sin equipo, sin posición y sin viajes lo dice', async () => {
    montar({
      ficha: {
        vehiculo: {
          ...FICHA.vehiculo,
          id: 'v-3',
          patente: 'ABCD12',
          empresa: { id: 'e-2', nombre: 'Logística Biobío SpA', rut: null },
          marca: null,
          modelo: null,
          anio: null,
          combustible: null,
          capacidad_kg: null,
          consumo_l_por_100km_base: null,
          teltonika_imei: null,
        },
        can: null,
        viajes: { ...FICHA.viajes, entregados: 0, en_curso: 0, ultimos: [] },
      },
    });
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Ver la ficha de ABCD12' }));

    const ficha = await screen.findByTestId('ficha-vehiculo');
    expect(ficha).toHaveTextContent('Sin equipo');
    expect(ficha).toHaveTextContent('Sin posición');
    expect(ficha).toHaveTextContent('Este vehículo no tiene un equipo Teltonika propio.');
    expect(ficha).toHaveTextContent('Este vehículo todavía no tiene viajes.');
    expect(within(ficha).queryByTestId('aviso-can')).not.toBeInTheDocument();
  });

  it('avisa si la lista llegó a su tope', async () => {
    montar({ flota: { vehiculos: FLOTA, truncada: true } });
    expect(await screen.findByText(/La lista llegó a su tope/)).toBeInTheDocument();
  });

  it('si la flota no carga, lo dice', async () => {
    montar({ falla: 'flota' });
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la flota');
  });

  it('si la ficha no carga, lo dice sin perder la lista', async () => {
    montar({ falla: 'ficha' });
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Ver la ficha de KZXB64' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar la ficha'),
    );
    expect(filas()).toHaveLength(3);
  });
});
