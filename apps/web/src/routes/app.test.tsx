import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  // D9 — el dashboard renderiza <Navigate to="/app/conductor/modo" /> cuando
  // el rol activo es conductor. Stub que no crashea en tests sin router real.
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const signOutUserMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: signOutUserMock,
}));

const { AppRoute } = await import('./app.js');

function makeMe(
  role: NonNullable<MeOnboarded['active_membership']>['role'] = 'dueno',
  isCarrier = true,
  isShipper = true,
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Felipe', email: 'a@b.cl' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e1',
        legal_name: 'Booster SpA',
        rut: '76',
        is_generador_carga: isShipper,
        is_transportista: isCarrier,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppRoute', () => {
  it('contexto no onboarded → no renderiza dashboard', () => {
    const { container } = render(<AppRoute />);
    expect(container.querySelector('h1')).toBeNull();
  });

  it('contexto onboarded → renderiza dashboard con título Bienvenido', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<AppRoute />);
    expect(screen.getByText('Bienvenido a Booster')).toBeInTheDocument();
    expect(screen.getAllByText('Booster SpA').length).toBeGreaterThan(0);
    expect(screen.getByText('Felipe')).toBeInTheDocument();
  });

  it('carrier → muestra card "Ofertas activas"', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    render(<AppRoute />);
    expect(screen.getByText(/Ofertas activas/)).toBeInTheDocument();
  });

  it('carrier → muestra card "Modo Conductor" linkeada a /app/conductor/modo', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', true, false) };
    render(<AppRoute />);
    const link = screen.getByTestId('dashboard-link-modo-conductor');
    expect(link).toBeInTheDocument();
    // TanStack Link mock pasa `to` como atributo (no `href`).
    expect(link).toHaveAttribute('to', '/app/conductor/modo');
  });

  it('shipper (no carrier) → NO muestra card "Modo Conductor"', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', false, true) };
    render(<AppRoute />);
    expect(screen.queryByTestId('dashboard-link-modo-conductor')).not.toBeInTheDocument();
  });

  it('shipper → muestra card "Crear carga"', () => {
    providedContext = { kind: 'onboarded', me: makeMe('dueno', false, true) };
    render(<AppRoute />);
    expect(screen.getByText(/Crear carga/)).toBeInTheDocument();
  });

  it('admin + transportista → muestra "Dispositivos pendientes"', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe('admin', true, false),
    };
    render(<AppRoute />);
    expect(screen.getByText(/Dispositivos pendientes/)).toBeInTheDocument();
  });

  it('no admin → no muestra admin dispositivos', () => {
    // D9: rol conductor ahora redirige a /app/conductor/modo, así que en
    // vez de chequear el dashboard original chequeamos que el Navigate
    // stub aparezca y que "Dispositivos pendientes" NO esté.
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    render(<AppRoute />);
    expect(screen.queryByText(/Dispositivos pendientes/)).not.toBeInTheDocument();
  });

  it('rol conductor → redirige a /app/conductor/modo (D9 surface guard)', () => {
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    render(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/conductor/modo');
    // El dashboard original NO debería renderizarse.
    expect(screen.queryByText('Bienvenido a Booster')).not.toBeInTheDocument();
  });

  it('platform admin → redirige a /app/platform-admin (sin importar memberships)', () => {
    const me = makeMe();
    (me.user as { is_platform_admin?: boolean }).is_platform_admin = true;
    providedContext = { kind: 'onboarded', me };
    render(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/platform-admin');
    expect(screen.queryByText('Bienvenido a Booster')).not.toBeInTheDocument();
  });

  it('platform admin SIN memberships (auto-provisioned) → redirige a /app/platform-admin', () => {
    const me: MeOnboarded = {
      needs_onboarding: false,
      user: {
        id: 'u',
        email: 'admin@boosterchile.com',
        full_name: 'Admin',
        phone: null,
        whatsapp_e164: null,
        rut: null,
        is_platform_admin: true,
        status: 'activo',
      },
      memberships: [],
      active_membership: null,
    };
    providedContext = { kind: 'onboarded', me };
    render(<AppRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app/platform-admin');
  });

  it('click Salir → signOutUser', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<AppRoute />);
    screen.getByRole('button', { name: 'Cerrar sesión' }).click();
    expect(signOutUserMock).toHaveBeenCalled();
  });
});
