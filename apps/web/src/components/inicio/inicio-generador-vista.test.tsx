import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../../hooks/use-me.js';
import { buildGeneradorHoy } from './generador.js';
import { InicioGeneradorVista } from './inicio-generador-vista.js';
import { InicioGenerador } from './inicio-generador.js';

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
        legal_name: 'Viña Santa Clara',
        rut: '76.000.000-0',
        is_generador_carga: true,
        is_transportista: false,
        status: 'activa',
      },
    },
  };
}

function renderInicio(role: 'dueno' | 'visualizador' = 'dueno') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InicioGenerador me={me(role)} soloLectura={role === 'visualizador'} />
    </QueryClientProvider>,
  );
}

describe('InicioGenerador', () => {
  it('en cero muestra cada bloque, una CTA y no vuelve a pedir los GET', async () => {
    apiGetSpy.mockImplementation(async (path: string) => {
      if (path.startsWith('/trip-requests-v2')) {
        return { trip_requests: [] };
      }
      if (path.startsWith('/certificates')) {
        return { certificates: [] };
      }
      return {};
    });
    renderInicio();
    expect((await screen.findAllByText('Sin cargas publicadas')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin retiros próximos').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Publicar carga').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Certificados al día').length).toBeGreaterThan(0);
    expect(screen.getByText('Crear carga')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const viajes = apiGetSpy.mock.calls.filter((call) => String(call[0]).includes('trip-requests'));
    const certs = apiGetSpy.mock.calls.filter((call) => String(call[0]).includes('certificates'));
    expect(viajes.length).toBeLessThanOrEqual(2);
    expect(certs.length).toBeLessThanOrEqual(2);
  });

  it('muestra skeleton mientras carga y el error de un bloque no esconde el otro', () => {
    const negocio = buildGeneradorHoy({ estado: 'cargando' }, { estado: 'error' }, new Date(), {
      soloLectura: false,
    });
    render(
      <InicioGeneradorVista
        saludo="Buenas tardes, Felipe"
        linea="Lunes 19 de octubre · Viña Santa Clara · Generador de carga"
        negocio={negocio}
        accesos={[]}
        soloLectura={false}
        onReintentar={() => undefined}
      />,
    );
    expect(screen.getAllByTestId('skeleton-cargas').length).toBeGreaterThan(0);
    expect(screen.getByTestId('skeleton-agenda')).toBeInTheDocument();
    expect(screen.getAllByText('No cargó Certificados').length).toBeGreaterThan(0);
    expect(screen.queryByText('Sin cargas publicadas')).not.toBeInTheDocument();
  });

  it('el visualizador ve Ver en vez de publicar', async () => {
    apiGetSpy.mockResolvedValue({ trip_requests: [], certificates: [] });
    renderInicio('visualizador');
    expect(await screen.findAllByText('Ver')).not.toHaveLength(0);
    expect(screen.queryByText('Publicar carga')).not.toBeInTheDocument();
  });
});
