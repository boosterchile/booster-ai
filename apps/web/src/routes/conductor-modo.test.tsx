import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const queryDriverPermissionsSpy = vi.fn();
const requestMicrophonePermissionSpy = vi.fn();
const requestGeolocationPermissionSpy = vi.fn();

vi.mock('../services/driver-mode-permissions.js', () => ({
  queryDriverPermissions: (...args: unknown[]) => queryDriverPermissionsSpy(...args),
  requestMicrophonePermission: (...args: unknown[]) => requestMicrophonePermissionSpy(...args),
  requestGeolocationPermission: (...args: unknown[]) => requestGeolocationPermissionSpy(...args),
}));

const loadAutoplayPreferenceSpy = vi.fn();
const saveAutoplayPreferenceSpy = vi.fn();

vi.mock('../services/coaching-voice.js', () => ({
  loadAutoplayPreference: () => loadAutoplayPreferenceSpy(),
  saveAutoplayPreference: (v: boolean) => saveAutoplayPreferenceSpy(v),
}));

const { ConductorModoRoute } = await import('./conductor-modo.js');

function makeMe(): MeOnboarded {
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
    },
    memberships: [],
    active_membership: null,
  } as unknown as MeOnboarded;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadAutoplayPreferenceSpy.mockReturnValue(false);
  queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductorModoRoute', () => {
  it('contexto no onboarded → no renderiza', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<ConductorModoRoute />);
    expect(container.querySelector('[data-testid="autoplay-card"]')).toBeNull();
  });

  it('contexto onboarded → renderiza las 4 cards', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorModoRoute />);
    expect(screen.getByTestId('layout')).toHaveAttribute('data-title', 'Modo Conductor');
    expect(screen.getByTestId('autoplay-card')).toBeInTheDocument();
    expect(screen.getByTestId('permissions-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-commands-card')).toBeInTheDocument();
    expect(screen.getByTestId('how-it-works-card')).toBeInTheDocument();
    await waitFor(() => expect(queryDriverPermissionsSpy).toHaveBeenCalled());
  });

  it('autoplay toggle persiste vía saveAutoplayPreference', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    loadAutoplayPreferenceSpy.mockReturnValue(false);
    render(<ConductorModoRoute />);
    const toggle = screen.getByTestId('autoplay-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(saveAutoplayPreferenceSpy).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(true);
  });

  it('estado inicial granted muestra pill "Activado" sin botón Permitir', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorModoRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-granted-pill')).toBeInTheDocument());
    expect(screen.getByTestId('geo-granted-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('mic-request-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('geo-request-btn')).not.toBeInTheDocument();
  });

  it('estado denied muestra instrucción de habilitar en settings', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'denied', geo: 'denied' });
    render(<ConductorModoRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-denied-help')).toBeInTheDocument());
    expect(screen.getByTestId('geo-denied-help')).toBeInTheDocument();
  });

  it('click "Permitir" del mic dispara requestMicrophonePermission y actualiza estado', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    requestMicrophonePermissionSpy.mockResolvedValue('granted');
    render(<ConductorModoRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-request-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mic-request-btn'));
    await waitFor(() => expect(requestMicrophonePermissionSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mic-granted-pill')).toBeInTheDocument());
  });

  it('click "Permitir" del GPS dispara requestGeolocationPermission y actualiza estado', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    requestGeolocationPermissionSpy.mockResolvedValue('granted');
    render(<ConductorModoRoute />);
    await waitFor(() => expect(screen.getByTestId('geo-request-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('geo-request-btn'));
    await waitFor(() => expect(requestGeolocationPermissionSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('geo-granted-pill')).toBeInTheDocument());
  });

  it('muestra los 4 comandos de voz con sus frases', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorModoRoute />);
    expect(screen.getByTestId('voice-cmd-aceptar_oferta')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-confirmar_entrega')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-marcar_incidente')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-cancelar')).toBeInTheDocument();
    // Phrase wrapper actually contains the canonical phrase.
    expect(screen.getAllByText(/"aceptar oferta"/i).length).toBeGreaterThanOrEqual(1);
  });

  it('muestra explainer del flujo en how-it-works card', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorModoRoute />);
    expect(screen.getByTestId('how-it-works-card')).toBeInTheDocument();
    expect(screen.getByText(/detección de vehículo parado/i)).toBeInTheDocument();
    expect(screen.getByText(/doble confirmación/i)).toBeInTheDocument();
    expect(screen.getByText(/Ley 18\.290/i)).toBeInTheDocument();
  });

  it('autoplay inicial cargado desde localStorage refleja en toggle', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    loadAutoplayPreferenceSpy.mockReturnValue(true);
    render(<ConductorModoRoute />);
    const toggle = screen.getByTestId('autoplay-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });
});
