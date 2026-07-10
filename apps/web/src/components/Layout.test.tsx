import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

// El Sidebar usa <Link> + useRouterState de @tanstack/react-router; traer el
// RouterProvider real es overkill. Link → <a>, useRouterState → pathname fijo.
vi.mock('@tanstack/react-router', () => ({
  // `to` → `href` para que el <a> tenga rol "link" en las queries por rol.
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useRouterState: () => '/app',
}));

const switchToMock = vi.fn();
vi.mock('../hooks/use-switch-company.js', () => ({
  useSwitchCompany: () => ({ switchTo: switchToMock, isPending: false }),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(async () => undefined),
}));

vi.mock('./ConsentTermsBanner.js', () => ({
  ConsentTermsBanner: () => null,
}));

import { signOutUser } from '../hooks/use-auth.js';
import { Layout } from './Layout.js';

const signOutUserMock = vi.mocked(signOutUser);

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function membership(
  id: string,
  name: string,
  flags: { transportista?: boolean; generador?: boolean } = { generador: true },
) {
  return {
    id: `m-${id}`,
    role: 'dueno' as const,
    status: 'activa' as const,
    joined_at: '2026-01-01T00:00:00Z',
    empresa: {
      id,
      legal_name: name,
      rut: '76.123.456-7',
      is_generador_carga: flags.generador ?? false,
      is_transportista: flags.transportista ?? false,
      status: 'activa' as const,
    },
  };
}

function buildMe(memberships: MeOnboarded['memberships']): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u-1',
      email: 'a@b.cl',
      full_name: 'Ana Pérez',
      phone: null,
      whatsapp_e164: null,
      rut: null,
      is_platform_admin: false,
      status: 'activo',
      auth_providers: [],
    },
    memberships,
    active_membership: memberships[0] ?? null,
  } as MeOnboarded;
}

describe('Layout — shell con sidebar', () => {
  it('el CompanySwitcher sigue accesible (nombre de la empresa activa)', () => {
    render(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>contenido</div>
      </Layout>,
    );
    expect(screen.getAllByText('Naviera Costera').length).toBeGreaterThanOrEqual(1);
  });

  it('renderiza children dentro del main y el title en la topbar', () => {
    render(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Contexto de prueba">
        <div>contenido del main</div>
      </Layout>,
    );
    expect(screen.getByText('contenido del main')).toBeInTheDocument();
    expect(screen.getByText('Contexto de prueba')).toBeInTheDocument();
  });

  it('sidebar role-aware: generador ve "Mis cargas", NO "Ofertas"', () => {
    render(
      <Layout me={buildMe([membership('e-1', 'Gen', { generador: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('link', { name: /Mis cargas/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Ofertas$/ })).not.toBeInTheDocument();
  });

  it('sidebar role-aware: transportista ve "Ofertas", NO "Mis cargas"', () => {
    render(
      <Layout me={buildMe([membership('e-1', 'Trans', { transportista: true })])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    expect(screen.getByRole('link', { name: /Ofertas/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mis cargas/ })).not.toBeInTheDocument();
  });

  it('hamburguesa abre el drawer (aria-expanded false → true)', () => {
    render(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const trigger = screen.getByRole('button', { name: 'Abrir menú' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // el drawer expone un diálogo de navegación
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();
  });

  it('click "Salir" llama signOutUser', () => {
    signOutUserMock.mockClear();
    render(
      <Layout me={buildMe([membership('e-1', 'Naviera Costera')])} title="Inicio">
        <div>x</div>
      </Layout>,
    );
    const salir = screen.getAllByRole('button', { name: /Salir/ })[0];
    if (!salir) {
      throw new Error('expected Salir button');
    }
    fireEvent.click(salir);
    expect(signOutUserMock).toHaveBeenCalled();
  });
});
