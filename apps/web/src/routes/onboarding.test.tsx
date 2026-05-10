import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeNeedsOnboarding = Extract<MeResponse, { needs_onboarding: true }>;
type ProtectedContext =
  | { kind: 'onboarded'; me: Extract<MeResponse, { needs_onboarding: false }> }
  | { kind: 'pre-onboarding'; me: MeNeedsOnboarding }
  | { kind: 'unmanaged' };

let providedContext: ProtectedContext = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: ProtectedContext) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('../components/onboarding/OnboardingForm.js', () => ({
  OnboardingForm: ({
    firebaseEmail,
    firebaseName,
  }: {
    firebaseEmail: string;
    firebaseName: string | undefined;
  }) => (
    <div data-testid="onboarding-form" data-email={firebaseEmail} data-name={firebaseName ?? ''} />
  ),
}));

const { OnboardingRoute } = await import('./onboarding.js');

function makeMe(name?: string, email?: string): MeNeedsOnboarding {
  return {
    needs_onboarding: true,
    firebase: {
      uid: 'fb-uid',
      email: email ?? 'felipe@boosterchile.com',
      name: name ?? 'Felipe Vicencio',
      picture: undefined,
      email_verified: true,
    },
  };
}

describe('OnboardingRoute', () => {
  it('contexto no pre-onboarding → no renderiza form', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<OnboardingRoute />);
    expect(container.querySelector('[data-testid="onboarding-form"]')).toBeNull();
  });

  it('contexto pre-onboarding → renderiza bienvenida + OnboardingForm', () => {
    providedContext = { kind: 'pre-onboarding', me: makeMe('Felipe Vicencio') };
    render(<OnboardingRoute />);
    expect(screen.getByText(/Bienvenido, Felipe/)).toBeInTheDocument();
    expect(screen.getByTestId('onboarding-form')).toHaveAttribute(
      'data-email',
      'felipe@boosterchile.com',
    );
  });

  it('me.firebase.name undefined → muestra solo "Bienvenido" sin nombre', () => {
    const me = makeMe(undefined);
    me.firebase.name = undefined;
    providedContext = { kind: 'pre-onboarding', me };
    render(<OnboardingRoute />);
    expect(screen.getByText(/^Bienvenido$/)).toBeInTheDocument();
  });

  it('me.firebase.email undefined → onboarding form recibe string vacío', () => {
    const me = makeMe('Test User');
    me.firebase.email = undefined;
    providedContext = { kind: 'pre-onboarding', me };
    render(<OnboardingRoute />);
    expect(screen.getByTestId('onboarding-form')).toHaveAttribute('data-email', '');
  });
});
