import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../../hooks/use-me.js';
import { vistaEmpresaElegida } from '../../lib/vista-admin.js';

/**
 * acceso-usuarios-empresa-panel SC9 — en el panel, la persona de Booster que
 * también es de una empresa ve «Ir a mi empresa» con el nombre de su empresa
 * activa. Sin membresía activa, el enlace no aparece.
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
}));

vi.mock('../../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));

let meData: MeResponse | undefined;
vi.mock('../../hooks/use-me.js', () => ({ useMe: () => ({ data: meData }) }));

const { PlatformAdminFrame } = await import('./PlatformAdminFrame.js');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Membership = NonNullable<MeOnboarded['active_membership']>;

const MEMBRESIA: Membership = {
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

function adminDeBooster(active: Membership | null): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u1',
      email: 'persona@boosterchile.com',
      full_name: 'Persona de Booster',
      phone: null,
      whatsapp_e164: null,
      rut: '11111111-1',
      is_platform_admin: true,
      status: 'activo',
    },
    memberships: active ? [active] : [],
    active_membership: active,
  };
}

function renderFrame() {
  return render(
    <PlatformAdminFrame volver={{ to: '/app/platform-admin', label: 'Volver' }}>
      <p>contenido</p>
    </PlatformAdminFrame>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  meData = undefined;
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('PlatformAdminFrame — Ir a mi empresa (SC9)', () => {
  it('con membresía activa muestra «Ir a mi empresa» con el nombre de la empresa', () => {
    meData = adminDeBooster(MEMBRESIA);
    renderFrame();

    const link = screen.getByTestId('platform-admin-ir-a-mi-empresa');
    expect(link).toHaveTextContent('Ir a mi empresa');
    expect(link).toHaveTextContent('Retail Norte SpA');
    expect(link).toHaveAttribute('href', '/app');
  });

  it('al usarlo deja elegida la web de la empresa en la pestaña', () => {
    meData = adminDeBooster(MEMBRESIA);
    renderFrame();

    expect(vistaEmpresaElegida()).toBe(false);
    fireEvent.click(screen.getByTestId('platform-admin-ir-a-mi-empresa'));
    expect(vistaEmpresaElegida()).toBe(true);
  });

  it('sin membresía activa no aparece', () => {
    meData = adminDeBooster(null);
    renderFrame();
    expect(screen.queryByTestId('platform-admin-ir-a-mi-empresa')).not.toBeInTheDocument();
  });

  it('con la membresía suspendida no aparece', () => {
    meData = adminDeBooster({ ...MEMBRESIA, status: 'suspendida' });
    renderFrame();
    expect(screen.queryByTestId('platform-admin-ir-a-mi-empresa')).not.toBeInTheDocument();
  });

  it('con una membresía sin empresa (stakeholder) no aparece', () => {
    meData = adminDeBooster({ ...MEMBRESIA, role: 'stakeholder_sostenibilidad', empresa: null });
    renderFrame();
    expect(screen.queryByTestId('platform-admin-ir-a-mi-empresa')).not.toBeInTheDocument();
  });

  it('sin registro en Booster (pre-onboarding) no aparece', () => {
    meData = {
      needs_onboarding: true,
      firebase: {
        uid: 'fb',
        email: 'x@boosterchile.com',
        name: undefined,
        picture: undefined,
        email_verified: true,
      },
    };
    renderFrame();
    expect(screen.queryByTestId('platform-admin-ir-a-mi-empresa')).not.toBeInTheDocument();
  });

  it('mientras /me no responde no aparece y el panel se muestra igual', () => {
    renderFrame();
    expect(screen.queryByTestId('platform-admin-ir-a-mi-empresa')).not.toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});
