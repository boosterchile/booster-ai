import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

/**
 * Tests del route `/app/conductor` (dashboard del conductor).
 *
 * Superficie principal del conductor logueado. Contiene:
 *   - Header con full name + ícono engranaje (navega a configuración).
 *   - Banner sticky de seguridad (no usar WhatsApp manejando).
 *   - Lista de servicios asignados con GPS reporter inline.
 *   - Empty state amable cuando el carrier no le ha asignado nada.
 *
 * Los tests de configuración (permisos, voice commands, autoplay) viven
 * en `conductor-configuracion.test.tsx`. Acá nos enfocamos en el flujo
 * operativo del driver.
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
vi.mock('../services/driver-mode-permissions.js', () => ({
  queryDriverPermissions: (...args: unknown[]) => queryDriverPermissionsSpy(...args),
}));

// ADR-036 (Wave 5) — el banner del wake-word usa useFeatureFlags. Default
// flag OFF en tests para que el banner no aparezca y los assertions
// existentes pasen sin cambios.
vi.mock('../hooks/use-feature-flags.js', () => ({
  useFeatureFlags: () => ({
    flags: {
      auth_universal_v1_activated: false,
      wake_word_voice_activated: false,
      matching_algorithm_v2_activated: false,
    },
    isLoading: false,
    isError: false,
  }),
}));

// Default mock para preference: wake-word OFF en localStorage.
vi.mock('../services/wake-word-preference.js', () => ({
  isWakeWordEnabled: () => false,
  setWakeWordEnabled: vi.fn(),
}));

const reporterStartSpy = vi.fn();
const reporterStopSpy = vi.fn();
let reporterState = {
  isWatching: false,
  lastPosition: null as { latitude: number; longitude: number; timestamp: string } | null,
  lastError: null as string | null,
  pointsSent: 0,
  start: reporterStartSpy,
  stop: reporterStopSpy,
};

vi.mock('../hooks/use-driver-position-reporter.js', () => ({
  useDriverPositionReporter: () => reporterState,
}));

const apiGetSpy = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetSpy(...args),
    },
  };
});

const { ConductorDashboardRoute } = await import('./conductor.js');

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      email: 'driver@boosterchile.invalid',
      full_name: 'Pedro Conductor',
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

const sampleAssignment = {
  id: 'asg-123-456',
  status: 'asignado',
  trip: {
    id: 'trip-1',
    tracking_code: 'BOO-ABC123',
    status: 'asignado',
    origin: { address_raw: 'Av. Pajaritos 1234, Maipú', region_code: 'XIII' },
    destination: { address_raw: 'Av. Brasil 2345, Valparaíso', region_code: 'V' },
    cargo_type: 'carga_seca',
    cargo_weight_kg: 5000,
    pickup_window_start: null,
    pickup_window_end: null,
  },
  carrier_empresa: { id: 'emp-c', legal_name: 'Transportes Demo Sur S.A.' },
  vehicle: { id: 'veh-1', plate: 'DEMO01' },
};

beforeEach(() => {
  vi.clearAllMocks();
  reporterState = {
    isWatching: false,
    lastPosition: null,
    lastError: null,
    pointsSent: 0,
    start: reporterStartSpy,
    stop: reporterStopSpy,
  };
  queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
  apiGetSpy.mockResolvedValue({ assignments: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductorDashboardRoute', () => {
  it('contexto no onboarded → no renderiza dashboard', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<ConductorDashboardRoute />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('header muestra full_name del usuario y link a configuración', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorDashboardRoute />);
    expect(screen.getByText('Pedro Conductor')).toBeInTheDocument();
    expect(screen.getByText('Conductor')).toBeInTheDocument();
    const cogLink = screen.getByTestId('link-configuracion-conductor');
    expect(cogLink).toHaveAttribute('to', '/app/conductor/configuracion');
  });

  it('banner sticky de WhatsApp es visible siempre (no oculto en config)', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorDashboardRoute />);
    expect(screen.getByText(/No uses WhatsApp manejando/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Booster te avisa por audio cuando hay algo importante/i),
    ).toBeInTheDocument();
  });

  it('sin servicios → empty state amable, NO crash', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText(/No tienes servicios asignados/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Cuando tu empresa de transporte te asigne un viaje/i),
    ).toBeInTheDocument();
  });

  it('un servicio → muestra "Tu próximo servicio" (singular) con detalles', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText('Tu próximo servicio')).toBeInTheDocument();
    expect(screen.getByText('BOO-ABC123')).toBeInTheDocument();
    expect(screen.getByText(/Av\. Pajaritos 1234, Maipú/)).toBeInTheDocument();
    expect(screen.getByText(/Av\. Brasil 2345, Valparaíso/)).toBeInTheDocument();
    expect(screen.getByText('DEMO01')).toBeInTheDocument();
  });

  it('múltiples servicios → muestra "Tus servicios asignados" (plural)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({
      assignments: [
        sampleAssignment,
        {
          ...sampleAssignment,
          id: 'asg-999',
          trip: { ...sampleAssignment.trip, tracking_code: 'BOO-XYZ789' },
        },
      ],
    });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText('Tus servicios asignados')).toBeInTheDocument();
    expect(screen.getByText('BOO-ABC123')).toBeInTheDocument();
    expect(screen.getByText('BOO-XYZ789')).toBeInTheDocument();
  });

  it('GPS reporter botón "Iniciar" está disabled si geoPermission ≠ granted', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    render(<ConductorDashboardRoute />);
    const startBtn = await screen.findByTestId('gps-start');
    expect(startBtn).toBeDisabled();
    expect(
      screen.getByText(/Para activar el reporte GPS, primero habilita el permiso de ubicación/i),
    ).toBeInTheDocument();
  });

  it('GPS reporter "Iniciar" está habilitado cuando geo=granted y no watching', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorDashboardRoute />);
    const startBtn = await screen.findByTestId('gps-start');
    await waitFor(() => expect(startBtn).not.toBeDisabled());
    fireEvent.click(startBtn);
    expect(reporterStartSpy).toHaveBeenCalledWith(sampleAssignment.id);
  });

  it('GPS reporter watching=true muestra contador + botón Detener', async () => {
    reporterState = {
      ...reporterState,
      isWatching: true,
      pointsSent: 42,
    };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText(/42 puntos enviados/)).toBeInTheDocument();
    const stopBtn = screen.getByTestId('gps-stop');
    fireEvent.click(stopBtn);
    expect(reporterStopSpy).toHaveBeenCalled();
  });

  it('error 404 de /me/assignments → mensaje amable, no stack trace', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    const { ApiError } = await import('../lib/api-client.js');
    apiGetSpy.mockRejectedValue(new ApiError(404, 'not_found', { code: 'not_found' }));
    render(<ConductorDashboardRoute />);
    expect(
      await screen.findByText(/No encontramos tu cuenta\. Vuelve a iniciar sesión/i),
    ).toBeInTheDocument();
  });

  it('vocabulario español neutro — no "tenés/elegí/acá/querés"', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    const { container } = render(<ConductorDashboardRoute />);
    await screen.findByText(/No tienes servicios asignados/i);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/\btenés\b/i);
    expect(text).not.toMatch(/\belegí\b/i);
    expect(text).not.toMatch(/\bquerés\b/i);
    expect(text).not.toMatch(/\bacá\b/i);
  });

  it('vocabulario driver — usa "servicio" (no "oferta")', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    await screen.findByText('Tu próximo servicio');
    // El driver no negocia ofertas — la palabra "oferta" no debería aparecer en su superficie.
    expect(screen.queryByText(/\boferta(s)?\b/i)).not.toBeInTheDocument();
  });
});
