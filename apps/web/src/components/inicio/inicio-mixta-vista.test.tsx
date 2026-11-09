import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../../hooks/use-me.js';
import type { DatosInicio } from '../inicio-transportista/modelo.js';
import { buildNegocioHoy } from '../inicio-transportista/negocio.js';
import { type ViajeInicio, buildGeneradorHoy } from './generador.js';
import { InicioMixtaVista } from './inicio-mixta-vista.js';
import { InicioMixta } from './inicio-mixta.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children?: ReactNode; to?: string }) => (
    <a href={typeof to === 'string' ? to : undefined} {...props}>
      {children}
    </a>
  ),
}));

const apiGetSpy = vi.hoisted(() => vi.fn());

vi.mock('../../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/api-client.js')>('../../lib/api-client.js');
  return {
    ...actual,
    api: { ...actual.api, get: (path: string, init?: RequestInit) => apiGetSpy(path, init) },
  };
});

vi.mock('../../lib/empresa-activa.js', () => ({
  useEmpresaScope: () => ({
    init: undefined,
    key: (...partes: string[]) => ['empresa', 'e1', ...partes],
  }),
}));

const AHORA = new Date('2026-10-19T16:30:00.000Z');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function me(role: 'dueno' | 'visualizador' = 'dueno'): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      email: 'felipe@boosterchile.com',
      full_name: 'Felipe Vicencio',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: false,
      status: 'activo',
    },
    memberships: [],
    active_membership: {
      id: 'm',
      role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e1',
        legal_name: 'Logística Andes SpA',
        rut: '76.000.000-0',
        is_generador_carga: true,
        is_transportista: true,
        status: 'activa',
      },
    },
  };
}

function datosBase(): DatosInicio {
  return {
    ofertas: { estado: 'listo', valor: [] },
    servicios: { estado: 'listo', valor: [] },
    cumplimiento: { estado: 'listo', valor: { vencidos: 0, porVencer30d: 0, documentos: [] } },
    flota: { estado: 'listo', valor: [] },
    vehiculos: { estado: 'listo', valor: 0 },
    conductores: { estado: 'listo', valor: 0 },
    cobraHoy: 'disponible',
  };
}

describe('InicioMixta', () => {
  it('en cero muestra los dos lados, sin neto y sin repetir los GET', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
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
        return { vehicles: [] };
      }
      if (path === '/conductores') {
        return { conductores: [] };
      }
      if (path.startsWith('/trip-requests-v2')) {
        return { trip_requests: [] };
      }
      if (path.startsWith('/certificates')) {
        return { certificates: [] };
      }
      return {};
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <InicioMixta me={me()} soloLectura={false} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Sin ofertas nuevas')).toBeInTheDocument();
    expect(screen.getByText('Sin cargas publicadas')).toBeInTheDocument();
    expect(screen.getByText('Sin movimientos en la agenda')).toBeInTheDocument();
    expect(screen.getByText('Facturado (transporte)')).toBeInTheDocument();
    expect(screen.getByText('Gasto (cargas)')).toBeInTheDocument();
    expect(screen.queryByText(/neto/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByText('Ofertas')).toBeInTheDocument();
    expect(screen.getByText('Crear carga')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const ofertas = apiGetSpy.mock.calls.filter((call) => String(call[0]).includes('/offers/mine'));
    const viajes = apiGetSpy.mock.calls.filter((call) => String(call[0]).includes('trip-requests'));
    expect(ofertas.length).toBeLessThanOrEqual(2);
    expect(viajes.length).toBeLessThanOrEqual(2);
  });

  it('el filtro Generador esconde la flota y deja las cargas', () => {
    const negocio = buildNegocioHoy(datosBase(), AHORA);
    const viaje: ViajeInicio = {
      id: 't-1',
      trackingCode: 'BST-4802',
      status: 'asignado',
      origen: 'Bodega, Rancagua',
      destino: 'Centro, Rancagua',
      pickupInicio: '2026-10-19T21:00:00.000Z',
      precioClp: 1000,
      transportista: null,
      avancePct: null,
      ofertasPendientes: null,
    };
    const generador = buildGeneradorHoy(
      { estado: 'listo', valor: [viaje] },
      { estado: 'listo', valor: [] },
      AHORA,
      { soloLectura: false },
    );
    render(
      <InicioMixtaVista
        saludo="Buenas tardes, Felipe"
        linea="Lunes 19 de octubre · Logística Andes SpA"
        negocio={negocio}
        generador={generador}
        ahora={AHORA}
        accesosTransporte={[{ label: 'Ofertas', to: '/app/ofertas', icon: Truck }]}
        accesosGenerador={[{ label: 'Crear carga', to: '/app/cargas/nueva', icon: Truck }]}
        soloLectura={false}
        onReintentar={() => undefined}
      />,
    );
    expect(screen.getByText('Ofertas para tu flota')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Generador' }));
    expect(screen.queryByText('Ofertas para tu flota')).not.toBeInTheDocument();
    expect(screen.getByText('Mis cargas publicadas')).toBeInTheDocument();
    expect(screen.getAllByText('Mi carga').length).toBeGreaterThan(0);
    expect(screen.queryByText('Facturado (transporte)')).not.toBeInTheDocument();
    expect(screen.getByText('Crear carga')).toBeInTheDocument();
    expect(screen.queryByText('Ofertas')).not.toBeInTheDocument();
  });
});
