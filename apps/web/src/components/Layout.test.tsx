import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

// Mockeamos el router porque Layout usa <Link> de @tanstack/react-router
// y traer el RouterProvider real al test es overkill para verificar la
// integración del switcher.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

const switchToMock = vi.fn();
vi.mock('../hooks/use-switch-company.js', () => ({
  useSwitchCompany: () => ({ switchTo: switchToMock, isPending: false }),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(),
}));

import { Layout } from './Layout.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

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

function membership(
  id: string,
  name: string,
  status: 'activa' | 'pendiente_invitacion' = 'activa',
) {
  return {
    id: `m-${id}`,
    role: 'dueno' as const,
    status,
    joined_at: '2026-01-01T00:00:00Z',
    empresa: {
      id,
      legal_name: name,
      rut: '76.123.456-7',
      is_generador_carga: true,
      is_transportista: false,
      status: 'activa' as const,
    },
  };
}

describe('Layout — integración del CompanySwitcher (FIX-013/§3.1)', () => {
  it('renderiza el switcher con la empresa activa cuando hay 1 membership', () => {
    const me = buildMe([membership('e-1', 'Naviera Costera')]);
    render(
      <Layout me={me} title="Cargas">
        <div>contenido</div>
      </Layout>,
    );
    // 1 sola empresa: el switcher renderiza el nombre sin dropdown.
    // Aparece dos veces (desktop visible + mobile dentro del menú colapsado);
    // basta con que esté al menos una vez para confirmar la integración.
    expect(screen.getAllByText('Naviera Costera').length).toBeGreaterThanOrEqual(1);
  });

  it('con 2+ memberships activas renderiza el dropdown del switcher', () => {
    const me = buildMe([
      membership('e-1', 'Naviera Costera'),
      membership('e-2', 'Transportes Andes'),
    ]);
    render(
      <Layout me={me} title="Cargas">
        <div>contenido</div>
      </Layout>,
    );
    // El switcher en modo dropdown renderiza un <button aria-haspopup="menu">.
    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThanOrEqual(1);
  });

  it('no renderiza el bloque "Empresa activa" del menú móvil cuando no hay memberships activas', () => {
    const me = buildMe([membership('e-1', 'Pendiente', 'pendiente_invitacion')]);
    render(
      <Layout me={me} title="Cargas">
        <div>contenido</div>
      </Layout>,
    );
    expect(screen.queryByText(/empresa activa/i)).not.toBeInTheDocument();
  });

  it('renderiza children dentro del main', () => {
    const me = buildMe([membership('e-1', 'Naviera Costera')]);
    render(
      <Layout me={me} title="Cargas">
        <div>contenido del main</div>
      </Layout>,
    );
    expect(screen.getByText('contenido del main')).toBeInTheDocument();
  });
});
