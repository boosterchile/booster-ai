import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const busqueda = vi.hoisted(() => ({ estado: 'operacion' }));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => '/apariencia/inicio',
  useSearch: () => ({ estado: busqueda.estado }),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(),
}));

const { AparienciaInicioRoute, vistaDePreview } = await import('./apariencia-inicio.js');

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AparienciaInicioRoute />
    </QueryClientProvider>,
  );
}

describe('vistaDePreview', () => {
  it('arma operación, vacío, error, carga y el antes', () => {
    expect(vistaDePreview('operacion')?.modo).toBe('operacion');
    expect(vistaDePreview('vacio')?.modo).toBe('empresa-nueva');
    expect(vistaDePreview('error')?.atencion.tipo).toBe('filas');
    expect(vistaDePreview('carga')?.enRuta?.estado).toBe('cargando');
    expect(vistaDePreview('antes')).toBeNull();
    expect(vistaDePreview('cualquier-cosa')?.modo).toBe('operacion');
  });
});

describe('AparienciaInicioRoute', () => {
  beforeEach(() => {
    busqueda.estado = 'operacion';
  });

  it('muestra el inicio nuevo y no menciona Por cobrar', async () => {
    renderRoute();
    expect(await screen.findByText('3 ofertas por responder')).toBeInTheDocument();
    expect(screen.getAllByText('Transportes Van Oosterwyk').length).toBeGreaterThan(0);
    expect(screen.queryByText(/por cobrar/i)).not.toBeInTheDocument();
  });

  it('estado vacío muestra la bienvenida', async () => {
    busqueda.estado = 'vacio';
    renderRoute();
    expect(await screen.findByText(/Bienvenido, Felipe/)).toBeInTheDocument();
    expect(screen.getByText('1 de 4')).toBeInTheDocument();
  });

  it('estado antes conserva la lista de cards', () => {
    busqueda.estado = 'antes';
    renderRoute();
    expect(screen.getByRole('heading', { name: 'Bienvenido a Booster' })).toBeInTheDocument();
    expect(screen.getByText('Ofertas activas')).toBeInTheDocument();
    expect(screen.getByText('Como transportista')).toBeInTheDocument();
  });
});
