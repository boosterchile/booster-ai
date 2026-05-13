import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

/**
 * Tests del route `/app/conductor/configuracion`.
 *
 * Este surface es la **configuración** del Modo Conductor: permisos
 * mic/GPS, audio coaching automático, lista de comandos de voz,
 * explainer del flujo. NO incluye reporte GPS (eso vive en
 * `/app/conductor`, el dashboard).
 *
 * Antecedente: estos tests son el port del antiguo
 * `conductor-modo.test.tsx`, quitando las assertions del GPS reporter
 * inline (movidas a `conductor.test.tsx`).
 */

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

// ADR-036 — el card WakeWord usa useFeatureFlags. Default flag OFF en
// tests para que el card aparezca como "Próximamente" (la mayoría de
// assertions existentes no tocan este card). El test dedicado al wake-word
// card setea el flag a true.
const useFeatureFlagsMock = vi.fn(() => ({
  flags: {
    auth_universal_v1_activated: false,
    wake_word_voice_activated: false,
    matching_algorithm_v2_activated: false,
  },
  isLoading: false,
  isError: false,
}));
vi.mock('../hooks/use-feature-flags.js', () => ({
  useFeatureFlags: () => useFeatureFlagsMock(),
}));

const wakeWordEnabledMock = vi.fn(() => false);
const setWakeWordEnabledMock = vi.fn();
vi.mock('../services/wake-word-preference.js', () => ({
  isWakeWordEnabled: () => wakeWordEnabledMock(),
  setWakeWordEnabled: (v: boolean) => setWakeWordEnabledMock(v),
}));

const { ConductorConfiguracionRoute } = await import('./conductor-configuracion.js');

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

describe('ConductorConfiguracionRoute', () => {
  it('contexto no onboarded → no renderiza', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<ConductorConfiguracionRoute />);
    expect(container.querySelector('[data-testid="autoplay-card"]')).toBeNull();
  });

  it('contexto onboarded → renderiza las 5 cards de configuración', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    expect(screen.getByTestId('autoplay-card')).toBeInTheDocument();
    expect(screen.getByTestId('permissions-card')).toBeInTheDocument();
    expect(screen.getByTestId('wake-word-card')).toBeInTheDocument();
    expect(screen.getByTestId('voice-commands-card')).toBeInTheDocument();
    expect(screen.getByTestId('how-it-works-card')).toBeInTheDocument();
    await waitFor(() => expect(queryDriverPermissionsSpy).toHaveBeenCalled());
  });

  it('WakeWord card con flag OFF → muestra "Próximamente"', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    expect(screen.getByTestId('wake-word-card')).toBeInTheDocument();
    expect(screen.getByTestId('wake-word-not-yet')).toBeInTheDocument();
    expect(screen.queryByTestId('wake-word-toggle')).not.toBeInTheDocument();
  });

  it('WakeWord card con flag ON → toggle visible y refleja preferencia', () => {
    useFeatureFlagsMock.mockReturnValueOnce({
      flags: {
        auth_universal_v1_activated: false,
        wake_word_voice_activated: true,
        matching_algorithm_v2_activated: false,
      },
      isLoading: false,
      isError: false,
    });
    wakeWordEnabledMock.mockReturnValueOnce(true);
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    const toggle = screen.getByTestId('wake-word-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('WakeWord toggle click → persiste vía setWakeWordEnabled', () => {
    useFeatureFlagsMock.mockReturnValueOnce({
      flags: {
        auth_universal_v1_activated: false,
        wake_word_voice_activated: true,
        matching_algorithm_v2_activated: false,
      },
      isLoading: false,
      isError: false,
    });
    wakeWordEnabledMock.mockReturnValueOnce(false);
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    const toggle = screen.getByTestId('wake-word-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(setWakeWordEnabledMock).toHaveBeenCalledWith(true);
  });

  it('header tiene flecha de vuelta a /app/conductor', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    const backLink = screen.getByLabelText(/Volver al panel del conductor/i);
    expect(backLink).toHaveAttribute('to', '/app/conductor');
  });

  it('botón "Listo, volver al panel" navega a /app/conductor', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    const doneLink = screen.getByText(/Listo, volver al panel/);
    expect(doneLink).toHaveAttribute('to', '/app/conductor');
  });

  it('autoplay toggle persiste vía saveAutoplayPreference', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    loadAutoplayPreferenceSpy.mockReturnValue(false);
    render(<ConductorConfiguracionRoute />);
    const toggle = screen.getByTestId('autoplay-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    expect(saveAutoplayPreferenceSpy).toHaveBeenCalledWith(true);
    expect(toggle.checked).toBe(true);
  });

  it('autoplay inicial cargado desde localStorage refleja en toggle', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    loadAutoplayPreferenceSpy.mockReturnValue(true);
    render(<ConductorConfiguracionRoute />);
    const toggle = screen.getByTestId('autoplay-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('estado inicial granted muestra pill "Activado" sin botón Permitir', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorConfiguracionRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-granted-pill')).toBeInTheDocument());
    expect(screen.getByTestId('geo-granted-pill')).toBeInTheDocument();
    expect(screen.queryByTestId('mic-request-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('geo-request-btn')).not.toBeInTheDocument();
  });

  it('estado denied muestra instrucción de habilitar en settings', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'denied', geo: 'denied' });
    render(<ConductorConfiguracionRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-denied-help')).toBeInTheDocument());
    expect(screen.getByTestId('geo-denied-help')).toBeInTheDocument();
  });

  it('click "Permitir" del mic dispara requestMicrophonePermission y actualiza estado', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    requestMicrophonePermissionSpy.mockResolvedValue('granted');
    render(<ConductorConfiguracionRoute />);
    await waitFor(() => expect(screen.getByTestId('mic-request-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('mic-request-btn'));
    await waitFor(() => expect(requestMicrophonePermissionSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('mic-granted-pill')).toBeInTheDocument());
  });

  it('click "Permitir" del GPS dispara requestGeolocationPermission y actualiza estado', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    requestGeolocationPermissionSpy.mockResolvedValue('granted');
    render(<ConductorConfiguracionRoute />);
    await waitFor(() => expect(screen.getByTestId('geo-request-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('geo-request-btn'));
    await waitFor(() => expect(requestGeolocationPermissionSpy).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('geo-granted-pill')).toBeInTheDocument());
  });

  it('muestra los 4 comandos de voz con sus frases canónicas', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    expect(screen.getByTestId('voice-cmd-aceptar_oferta')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-confirmar_entrega')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-marcar_incidente')).toBeInTheDocument();
    expect(screen.getByTestId('voice-cmd-cancelar')).toBeInTheDocument();
    expect(screen.getAllByText(/"aceptar oferta"/i).length).toBeGreaterThanOrEqual(1);
  });

  it('muestra explainer del flujo en how-it-works card', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorConfiguracionRoute />);
    expect(screen.getByTestId('how-it-works-card')).toBeInTheDocument();
    expect(screen.getByText(/detección de vehículo parado/i)).toBeInTheDocument();
    expect(screen.getByText(/doble confirmación/i)).toBeInTheDocument();
    expect(screen.getByText(/Ley 18\.290/i)).toBeInTheDocument();
  });
});
