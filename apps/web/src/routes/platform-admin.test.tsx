import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

/**
 * Tests del route `/app/platform-admin` — la home del panel interno.
 *
 * Cubre que cada herramienta del panel tenga su entrada visible. El caso de
 * `/app/platform-admin/signup-requests` es el que motivó este archivo: la ruta
 * existía y funcionaba, pero no estaba enlazada desde ninguna parte, así que
 * la única forma de llegar era escribir la URL a mano. Con el alta de clientes
 * activada (runbook paso 5, 2026-07-30) ese panel es el camino de aprobación
 * de cada cliente nuevo, y no puede depender de conocer la URL de memoria.
 *
 * Patrón de mocks (consistente con platform-admin-signup-requests.test.tsx):
 *   - `ProtectedRoute` bypass (meRequirement="skip" → children(unmanaged)).
 *   - `Link` de tanstack-router → `<a>` (mapea `to` → `href`).
 *   - `ImpersonationPicker` stubbeado: pega a la API y no es lo que se prueba acá.
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

vi.mock('../components/ImpersonationPicker.js', () => ({
  ImpersonationPicker: () => <div data-testid="impersonation-picker-stub" />,
}));

vi.mock('../lib/api-client.js', () => ({
  api: {
    get: vi.fn(async (path: string) => {
      if (typeof path === 'string' && path.startsWith('/admin/empresas')) {
        return { empresas: [] };
      }
      return { organizations: [] };
    }),
    post: vi.fn(),
    patch: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

const { PlatformAdminRoute, PlatformAdminStakeholdersRoute } = await import('./platform-admin.js');
const { PlatformAdminEmpresasRoute } = await import('./platform-admin-empresas.js');
const { PlatformAdminTeltonikaRoute } = await import('./platform-admin-teltonika.js');
const { PlatformAdminImpersonarRoute } = await import('./platform-admin-impersonar.js');

describe('/app/platform-admin — entradas del panel', () => {
  it('enlaza a Solicitudes de registro con la ruta correcta', () => {
    render(<PlatformAdminRoute />);

    const link = screen.getByTestId('signup-requests-link');
    expect(link).toHaveAttribute('href', '/app/platform-admin/signup-requests');
  });

  it('describe para qué sirve, sin obligar a conocer la URL', () => {
    render(<PlatformAdminRoute />);

    expect(screen.getByText(/Solicitudes de registro/i)).toBeInTheDocument();
  });

  it('mantiene visibles las demás herramientas del panel', () => {
    render(<PlatformAdminRoute />);

    expect(screen.getByTestId('matching-backtest-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/matching',
    );
    expect(screen.getByTestId('observability-dashboard-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/observability',
    );
    expect(screen.getByTestId('site-settings-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/site-settings',
    );
    expect(screen.getByTestId('empresas-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/empresas',
    );
    expect(screen.getByTestId('teltonika-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/teltonika',
    );
    expect(screen.getByTestId('stakeholders-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/stakeholders',
    );
    expect(screen.getByTestId('impersonar-link')).toHaveAttribute(
      'href',
      '/app/platform-admin/impersonar',
    );
    expect(screen.getByTestId('platform-admin-volver')).toHaveAttribute('href', '/login');
    expect(screen.getByTestId('platform-admin-volver')).toHaveTextContent('Volver al login');
    expect(screen.queryByTestId('teltonika-empresa')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Crear empresa' })).not.toBeInTheDocument();
  });
});

describe('páginas de Admin — volver al índice', () => {
  it('empresas vuelve al índice y muestra el alta', () => {
    render(<PlatformAdminEmpresasRoute />);
    expect(screen.getByTestId('platform-admin-volver')).toHaveAttribute(
      'href',
      '/app/platform-admin',
    );
    expect(screen.getByTestId('platform-admin-volver')).toHaveTextContent('Volver');
    expect(screen.getByRole('heading', { name: 'Crear empresa' })).toBeInTheDocument();
  });

  it('teltonika vuelve al índice', async () => {
    render(<PlatformAdminTeltonikaRoute />);
    expect(screen.getByTestId('platform-admin-volver')).toHaveAttribute(
      'href',
      '/app/platform-admin',
    );
    expect(
      await screen.findByRole('heading', { name: 'Dispositivos Teltonika' }),
    ).toBeInTheDocument();
  });

  it('stakeholders vuelve al índice', () => {
    render(<PlatformAdminStakeholdersRoute />);
    expect(screen.getByTestId('platform-admin-volver')).toHaveAttribute(
      'href',
      '/app/platform-admin',
    );
    expect(screen.getByRole('heading', { name: 'Organizaciones stakeholder' })).toBeInTheDocument();
  });

  it('impersonar vuelve al índice', () => {
    render(<PlatformAdminImpersonarRoute />);
    expect(screen.getByTestId('platform-admin-volver')).toHaveAttribute(
      'href',
      '/app/platform-admin',
    );
    expect(screen.getByTestId('impersonation-picker-stub')).toBeInTheDocument();
  });
});
