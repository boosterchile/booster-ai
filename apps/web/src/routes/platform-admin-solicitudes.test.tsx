import type { SolicitudBoosterAbierta } from '@booster-ai/shared-schemas';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

/**
 * `.specs/frente2-cierre` §3.4 — `/app/platform-admin/solicitudes`: las
 * solicitudes «Pedir a Booster» abiertas y «Marcar resuelta».
 */
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: { kind: 'unmanaged' }) => ReactNode }) => (
    <>{children({ kind: 'unmanaged' })}</>
  ),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) => {
    const ruta = Object.entries(params ?? {}).reduce(
      (acumulado, [clave, valor]) => acumulado.replace(`$${clave}`, valor),
      to,
    );
    return (
      <a href={ruta} {...rest}>
        {children}
      </a>
    );
  },
}));
vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));
vi.mock('../hooks/use-me.js', () => ({ useMe: () => ({ data: undefined }) }));

const { PlatformAdminSolicitudesRoute } = await import('./platform-admin-solicitudes.js');

const solicitud = (extra: Partial<SolicitudBoosterAbierta>): SolicitudBoosterAbierta => ({
  id: '33333333-3333-4333-8333-333333333333',
  tipo: 'configurar_fuente_combustible',
  empresa: { id: '11111111-1111-4111-8111-111111111111', nombre: 'Transportes Andes Ltda.' },
  vehiculo: { id: '22222222-2222-4222-8222-222222222222', patente: 'KZXB64' },
  creada_en: '2026-11-26T15:00:00.000Z',
  ...extra,
});

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminSolicitudesRoute', () => {
  it('lista las abiertas con empresa, patente, qué piden y cuándo', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      solicitudes: [
        solicitud({}),
        solicitud({
          id: '44444444-4444-4444-8444-444444444444',
          empresa: { id: '55555555-5555-4555-8555-555555555555', nombre: 'Logística Biobío SpA' },
          vehiculo: { id: '66666666-6666-4666-8666-666666666666', patente: 'ABCD12' },
        }),
      ],
    });
    wrap(<PlatformAdminSolicitudesRoute />);
    expect(get).toHaveBeenCalledWith('/admin/plataforma/solicitudes');
    const filas = await screen.findAllByTestId('solicitud-booster');
    expect(filas).toHaveLength(2);
    const primera = filas[0] as HTMLElement;
    expect(within(primera).getByText('Transportes Andes Ltda.')).toBeInTheDocument();
    expect(within(primera).getByText('KZXB64')).toBeInTheDocument();
    expect(
      within(primera).getByText('Configurar la fuente CAN de combustible'),
    ).toBeInTheDocument();
    expect(within(primera).getByText(/26 nov/)).toBeInTheDocument();
    expect(within(primera).getByRole('button', { name: 'Marcar resuelta' })).toBeEnabled();
  });

  it('sin abiertas lo dice', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ solicitudes: [] });
    wrap(<PlatformAdminSolicitudesRoute />);
    expect(await screen.findByText('No hay solicitudes abiertas.')).toBeInTheDocument();
  });

  it('«Marcar resuelta» la resuelve y vuelve a leer la lista', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ solicitudes: [solicitud({})] })
      .mockResolvedValueOnce({ solicitudes: [] });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      solicitud: {
        id: '33333333-3333-4333-8333-333333333333',
        tipo: 'configurar_fuente_combustible',
        estado: 'resuelta',
        resuelta_en: '2026-11-26T16:00:00.000Z',
        resuelta_por: 'admin',
      },
    });
    wrap(<PlatformAdminSolicitudesRoute />);
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar resuelta' }));
    expect(post).toHaveBeenCalledWith(
      '/admin/plataforma/solicitudes/33333333-3333-4333-8333-333333333333/resolver',
      {},
    );
    expect(await screen.findByText('No hay solicitudes abiertas.')).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('si otra persona ya la resolvió, lo dice y la saca de la lista', async () => {
    vi.spyOn(api, 'get')
      .mockResolvedValueOnce({ solicitudes: [solicitud({})] })
      .mockResolvedValueOnce({ solicitudes: [] });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, 'solicitud_ya_resuelta', null, 'ya resuelta'),
    );
    wrap(<PlatformAdminSolicitudesRoute />);
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar resuelta' }));
    expect(await screen.findByText(/Otra persona de Booster ya la resolvió/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Marcar resuelta' })).toBeNull(),
    );
  });

  it('si la lista no carga lo dice', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'internal', null, 'falló'));
    wrap(<PlatformAdminSolicitudesRoute />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No se pudieron leer las solicitudes/,
    );
  });
});
