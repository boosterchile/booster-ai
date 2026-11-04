import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../../hooks/use-me.js';
import { empresaKey } from '../../lib/empresa-activa.js';
import { InicioTransportista } from './inicio-transportista.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };

const apiGetSpy = vi.hoisted(() => vi.fn());

vi.mock('../../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children({ kind: 'onboarded', me: meCarrier() })}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : undefined} {...props}>
      {children}
    </a>
  ),
  Navigate: () => null,
  useRouterState: () => '/app',
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearch: () => ({}),
}));

vi.mock('../../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(),
}));

vi.mock('../../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client.js')>('../../lib/api-client.js');
  return { ...actual, api: { ...actual.api, get: (path: string) => apiGetSpy(path) } };
});

vi.mock('../../components/map/FleetMap.js', () => ({
  FleetMap: ({ vehicles }: { vehicles: Array<{ id: string; plate: string }> }) => (
    <div data-testid="fleet-map" data-count={vehicles.length}>
      {vehicles.map((vehiculo) => (
        <div key={vehiculo.id} data-marker-plate={vehiculo.plate} />
      ))}
    </div>
  ),
}));

const { OfertasRoute } = await import('../../routes/ofertas.js');
const { ServiciosRoute } = await import('../../routes/servicios.js');
const { CumplimientoRoute } = await import('../../routes/cumplimiento.js');
const { FlotaRoute } = await import('../../routes/flota.js');
const { VehiculosListRoute } = await import('../../routes/vehiculos.js');
const { ConductoresListRoute } = await import('../../routes/conductores.js');

function meCarrier(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Felipe', email: 'a@b.cl' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: 'dueno',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e1',
        legal_name: 'Transportes Van Oosterwyk',
        rut: '76',
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

function oferta(id: string, tracking: string) {
  return {
    id,
    status: 'pendiente',
    score: 0.5,
    proposed_price_clp: 120000,
    suggested_vehicle_id: null,
    sent_at: '2026-10-19T12:00:00.000Z',
    expires_at: '2026-10-19T18:00:00.000Z',
    responded_at: null,
    rejection_reason: null,
    trip_request: {
      id: `tr-${id}`,
      tracking_code: tracking,
      status: 'publicada',
      origin_address_raw: 'Bodega',
      origin_region_code: 'XIII',
      destination_address_raw: 'Puerto',
      destination_region_code: 'V',
      cargo_type: 'carga_seca',
      cargo_weight_kg: 1000,
      pickup_window_start: null,
      pickup_window_end: null,
    },
  };
}

function payload(): unknown {
  return null;
}

function respuesta(path: string): unknown {
  if (path.startsWith('/offers/mine')) {
    return { offers: [oferta('o1', 'TRK-1'), oferta('o2', 'TRK-2')] };
  }
  if (path === '/assignments') {
    return {
      assignments: [
        {
          id: 'asg-1',
          status: 'asignado',
          accepted_at: null,
          picked_up_at: null,
          agreed_price_clp: 80000,
          driver: null,
          vehicle: null,
          trip: {
            id: 'trip-1',
            tracking_code: 'SRV-9',
            status: 'asignado',
            origin: { address_raw: 'Bodega norte, Quilicura', region_code: 'XIII' },
            destination: { address_raw: 'Puerto', region_code: 'V' },
            cargo_type: 'carga_seca',
            cargo_weight_kg: 500,
            pickup_window_start: '2026-10-20T11:00:00.000Z',
            pickup_window_end: null,
          },
        },
      ],
    };
  }
  if (path === '/cumplimiento') {
    return {
      resumen: { vencidos: 1, por_vencer_30d: 0, total_pendientes: 1 },
      vehiculos: [
        {
          documento_id: 'doc-1',
          vehiculo_id: 'veh-1',
          plate: 'ABCD12',
          tipo: 'soap',
          estado: 'vencido',
          fecha_vencimiento: '2026-01-01',
        },
      ],
      conductores: [],
    };
  }
  if (path === '/vehiculos/flota') {
    return {
      fleet: [
        {
          id: 'veh-1',
          plate: 'ABCD12',
          type: 'camion_mediano',
          teltonika_imei: '111',
          teltonika_source: 'own',
          status: 'activo',
          position: {
            timestamp_device: '2026-10-19T14:50:00.000Z',
            latitude: -33.45,
            longitude: -70.66,
            speed_kmh: 40,
            angle_deg: 10,
          },
        },
      ],
    };
  }
  if (path === '/vehiculos') {
    return {
      vehicles: [
        {
          id: 'veh-1',
          plate: 'ABCD12',
          type: 'camion_mediano',
          capacity_kg: 3500,
          status: 'activo',
        },
      ],
    };
  }
  if (path === '/conductores') {
    return {
      conductores: [
        {
          id: 'con-1',
          user_id: 'u-c',
          empresa_id: 'e1',
          license_class: 'A4',
          license_number: '123',
          license_expiry: '2027-12-31',
          is_extranjero: false,
          status: 'activo',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          deleted_at: null,
          user: {
            id: 'u-c',
            full_name: 'Rosa Díaz',
            rut: '11.111.111-1',
            email: 'rosa@b.cl',
            phone: null,
            is_pending: false,
          },
        },
      ],
    };
  }
  return payload();
}

function clienteNuevo(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000, gcTime: 60_000 } },
  });
}

function renderEn(client: QueryClient, ui: ReactNode) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('caché del inicio compatible con las pantallas dueñas', () => {
  beforeEach(() => {
    apiGetSpy.mockReset();
    apiGetSpy.mockImplementation(async (path: string) => respuesta(path));
  });

  it('monta el inicio y después cada destino con el mismo QueryClient', async () => {
    const client = clienteNuevo();
    const inicio = renderEn(
      client,
      <InicioTransportista
        nombreCompleto="Felipe Vicencio"
        legalName="Transportes Van Oosterwyk"
        esAdmin={false}
      />,
    );
    expect(await screen.findByText('2 ofertas por responder')).toBeInTheDocument();
    expect(screen.getByText('1 servicio sin conductor')).toBeInTheDocument();

    const clave = (
      dominio: 'offers' | 'assignments' | 'cumplimiento' | 'flota' | 'vehiculos' | 'conductores',
      ...resto: string[]
    ) => empresaKey(null, dominio, ...resto);

    const ofertas = client.getQueryData(clave('offers', 'mine', 'pendiente'));
    expect(ofertas).toEqual(expect.objectContaining({ offers: expect.any(Array) }));
    expect(Array.isArray(ofertas)).toBe(false);

    const asignaciones = client.getQueryData(clave('assignments', 'empresa'));
    expect(Array.isArray(asignaciones)).toBe(true);
    expect(asignaciones).toEqual([
      expect.objectContaining({
        id: 'asg-1',
        trip: expect.objectContaining({ tracking_code: 'SRV-9' }),
      }),
    ]);

    const cumplimiento = client.getQueryData<{ resumen: { vencidos: number } }>(
      clave('cumplimiento'),
    );
    expect(cumplimiento?.resumen.vencidos).toBe(1);

    const flota = client.getQueryData<Array<{ position: { latitude: number } | null }>>(
      clave('flota'),
    );
    expect(flota?.[0]?.position?.latitude).toBe(-33.45);

    expect(Array.isArray(client.getQueryData(clave('vehiculos')))).toBe(true);
    expect(Array.isArray(client.getQueryData(clave('conductores')))).toBe(true);

    apiGetSpy.mockImplementation(async () => {
      throw new Error('sin red');
    });
    inicio.unmount();

    const ofertasPagina = renderEn(client, <OfertasRoute />);
    expect(await screen.findByText('TRK-1')).toBeInTheDocument();
    expect(screen.getByText('TRK-2')).toBeInTheDocument();
    ofertasPagina.unmount();

    const serviciosPagina = renderEn(client, <ServiciosRoute />);
    expect(await screen.findByText('SRV-9')).toBeInTheDocument();
    expect(screen.getByText('Sin conductor asignado')).toBeInTheDocument();
    serviciosPagina.unmount();

    const cumplimientoPagina = renderEn(client, <CumplimientoRoute />);
    expect(await screen.findByText('Vencidos')).toBeInTheDocument();
    expect(screen.getByText('Cumplimiento normativo')).toBeInTheDocument();
    cumplimientoPagina.unmount();

    const flotaPagina = renderEn(client, <FlotaRoute />);
    expect(await screen.findByTestId('fleet-map')).toHaveAttribute('data-count', '1');
    expect(
      screen.getByTestId('fleet-map').querySelector('[data-marker-plate="ABCD12"]'),
    ).not.toBeNull();
    flotaPagina.unmount();

    const vehiculosPagina = renderEn(client, <VehiculosListRoute />);
    expect((await screen.findAllByText('Camión mediano')).length).toBeGreaterThan(0);
    vehiculosPagina.unmount();

    renderEn(client, <ConductoresListRoute />);
    expect((await screen.findAllByText('Rosa Díaz')).length).toBeGreaterThan(0);
  });

  it('si ofertas llenó la caché primero, el inicio no itera el objeto', async () => {
    const client = clienteNuevo();
    const pagina = renderEn(client, <OfertasRoute />);
    expect(await screen.findByText('TRK-1')).toBeInTheDocument();
    pagina.unmount();
    apiGetSpy.mockImplementation(async () => {
      throw new Error('sin red');
    });
    renderEn(
      client,
      <InicioTransportista
        nombreCompleto="Felipe Vicencio"
        legalName="Transportes Van Oosterwyk"
        esAdmin={false}
      />,
    );
    expect(await screen.findByText('2 ofertas por responder')).toBeInTheDocument();
  });
});
