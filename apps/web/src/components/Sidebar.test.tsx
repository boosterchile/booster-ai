import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { elegirVistaEmpresa, vistaEmpresaElegida } from '../lib/vista-admin.js';

/**
 * acceso-usuarios-empresa-panel SC9 — en el menú de la web de la empresa, la
 * persona de Booster ve «Panel de Booster», que la devuelve al panel y limpia
 * la elección de la pestaña.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    onClick,
    ...rest
  }: { children: ReactNode; to: string; onClick?: () => void }) => (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
  useRouterState: () => '/app',
}));

vi.mock('../hooks/use-switch-company.js', () => ({
  useSwitchCompany: () => ({ switchTo: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));

const { Sidebar } = await import('./Sidebar.js');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function buildMe(isPlatformAdmin: boolean): MeOnboarded {
  const membership: NonNullable<MeOnboarded['active_membership']> = {
    id: 'm1',
    role: 'admin',
    status: 'activa',
    joined_at: null,
    empresa: {
      id: 'e1',
      legal_name: 'Retail Norte SpA',
      rut: '76274900-9',
      is_generador_carga: true,
      is_transportista: false,
      status: 'activa',
    },
  };
  return {
    needs_onboarding: false,
    user: {
      id: 'u1',
      email: 'persona@boosterchile.com',
      full_name: 'Persona',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: isPlatformAdmin,
      status: 'activo',
    },
    memberships: [membership],
    active_membership: membership,
  };
}

function renderSidebar(me: MeOnboarded, onNavigate?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Sidebar me={me} {...(onNavigate ? { onNavigate } : {})} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('Sidebar — Panel de Booster (SC9)', () => {
  it('la persona de Booster ve «Panel de Booster», que lleva al panel', () => {
    renderSidebar(buildMe(true));
    const link = screen.getByTestId('sidebar-panel-booster');
    expect(link).toHaveTextContent('Panel de Booster');
    expect(link).toHaveAttribute('href', '/app/platform-admin');
  });

  it('al usarlo limpia la elección de la pestaña y cierra el menú móvil', () => {
    elegirVistaEmpresa();
    const onNavigate = vi.fn();
    renderSidebar(buildMe(true), onNavigate);

    fireEvent.click(screen.getByTestId('sidebar-panel-booster'));

    expect(vistaEmpresaElegida()).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('quien no es de Booster no lo ve', () => {
    renderSidebar(buildMe(false));
    expect(screen.queryByTestId('sidebar-panel-booster')).not.toBeInTheDocument();
    expect(screen.queryByText('Panel de Booster')).not.toBeInTheDocument();
  });
});
