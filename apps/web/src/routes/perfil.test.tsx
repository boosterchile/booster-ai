import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type ProtectedContext =
  | { kind: 'onboarded'; me: MeOnboarded }
  | { kind: 'pre-onboarding'; me: Extract<MeResponse, { needs_onboarding: true }> }
  | { kind: 'unmanaged' };

let providedContext: ProtectedContext = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: ProtectedContext) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../components/profile/ProfileForm.js', () => ({
  ProfileForm: (props: { initial: { full_name: string } }) => (
    <div data-testid="profile-form" data-name={props.initial.full_name} />
  ),
}));

vi.mock('../components/profile/AuthProvidersSection.js', () => ({
  AuthProvidersSection: () => <div data-testid="auth-providers" />,
}));

vi.mock('../components/profile/TwoFactorSection.js', () => ({
  TwoFactorSection: (props: { initialPhoneE164?: string | null }) => (
    <div data-testid="two-factor" data-phone={props.initialPhoneE164 ?? ''} />
  ),
}));

const { PerfilRoute } = await import('./perfil.js');

function makeMe(over: Partial<MeOnboarded['user']> = {}): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      email: 'felipe@boosterchile.com',
      full_name: 'Felipe Vicencio',
      phone: '+56912345678',
      whatsapp_e164: '+56912345678',
      rut: '12.345.678-9',
      is_platform_admin: false,
      status: 'activo',
      ...over,
    },
    memberships: [],
    active_membership: null,
  } as MeOnboarded;
}

describe('PerfilRoute', () => {
  it('contexto no onboarded → no renderiza página', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<PerfilRoute />);
    expect(container.querySelector('[data-testid="profile-form"]')).toBeNull();
  });

  it('contexto onboarded → renderiza Layout + ProfileForm + AuthProviders + TwoFactor', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<PerfilRoute />);
    expect(screen.getByTestId('layout')).toHaveAttribute('data-title', 'Mi cuenta');
    expect(screen.getByTestId('profile-form')).toHaveAttribute('data-name', 'Felipe Vicencio');
    expect(screen.getByTestId('auth-providers')).toBeInTheDocument();
    expect(screen.getByTestId('two-factor')).toHaveAttribute('data-phone', '+56912345678');
  });

  it('whatsapp null + phone presente → TwoFactor recibe phone como fallback', () => {
    providedContext = { kind: 'onboarded', me: makeMe({ whatsapp_e164: null }) };
    render(<PerfilRoute />);
    expect(screen.getByTestId('two-factor')).toHaveAttribute('data-phone', '+56912345678');
  });

  it('whatsapp y phone null → TwoFactor recibe string vacío', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({ whatsapp_e164: null, phone: null }),
    };
    render(<PerfilRoute />);
    expect(screen.getByTestId('two-factor')).toHaveAttribute('data-phone', '');
  });
});
