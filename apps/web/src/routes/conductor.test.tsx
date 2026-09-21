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
  // `to` → `href`: sin esto el mock renderiza un `<a>` sin href, que para axe
  // tiene rol `generic` y hace ilegal su `aria-label`. En producción el Link de
  // TanStack sí emite href, así que era un falso positivo del mock.
  Link: ({
    children,
    to,
    params,
    ...props
  }: { children: ReactNode; to: string; params?: unknown }) => {
    void params;
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  },
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const queryDriverPermissionsSpy = vi.fn();
vi.mock('../services/driver-mode-permissions.js', () => ({
  queryDriverPermissions: (...args: unknown[]) => queryDriverPermissionsSpy(...args),
}));

// ADR-036 (Wave 5) — el banner del wake-word usa useFeatureFlags. Default
// flag OFF en tests para que el banner no aparezca y los assertions
// existentes pasen sin cambios.
// Mutable para poder encender el flag en un test puntual sin afectar al resto.
let wakeWordFlag = false;
vi.mock('../hooks/use-feature-flags.js', () => ({
  useFeatureFlags: () => ({
    flags: {
      auth_universal_v1_activated: false,
      get wake_word_voice_activated() {
        return wakeWordFlag;
      },
      matching_algorithm_v2_activated: false,
    },
    isLoading: false,
    isError: false,
  }),
}));

// Default mock para preference: wake-word OFF en localStorage.
let wakeWordPreferido = false;
vi.mock('../services/wake-word-preference.js', () => ({
  isWakeWordEnabled: () => wakeWordPreferido,
  setWakeWordEnabled: vi.fn(),
}));

const reporterStartSpy = vi.fn();
const reporterStopSpy = vi.fn();
const reporterFlushSpy = vi.fn(async () => ({ enviados: 0, restantes: 0 }));
type GeofenceLectura = import('../hooks/use-driver-position-reporter.js').GeofenceLectura;
let reporterState = {
  isWatching: false,
  lastPosition: null as { latitude: number; longitude: number; timestamp: string } | null,
  lastError: null as string | null,
  pointsSent: 0,
  lastGeofence: null as GeofenceLectura | null,
  queued: 0,
  enSegundoPlano: false,
  avisoPausa: false,
  start: reporterStartSpy,
  stop: reporterStopSpy,
  flush: reporterFlushSpy,
};

vi.mock('../hooks/use-driver-position-reporter.js', () => ({
  useDriverPositionReporter: () => reporterState,
}));

// Ruta eco de la asignación (Routes API): sus extremos son las coordenadas
// reales de origen y destino, que Google Maps sí entiende aunque la dirección
// en texto no («Ruta 5 Norte km 470» no la encuentra — reporte del PO).
let ecoRouteState: {
  data?: { polyline_encoded: string | null };
  isPending?: boolean;
} = {};
vi.mock('../hooks/use-assignment-eco-route.js', () => ({
  useAssignmentEcoRoute: () => ecoRouteState,
}));

vi.mock('../components/offers/EcoRouteMapPreview.js', () => ({
  EcoRouteMapPreview: ({ polylineEncoded }: { polylineEncoded: string }) => (
    <div data-testid="eco-route-map">{polylineEncoded}</div>
  ),
}));

vi.mock('../components/scoring/AssignmentEcoRouteCard.js', () => ({
  AssignmentEcoRouteCard: ({ assignmentId }: { assignmentId: string }) => (
    <section data-testid="assignment-eco-route-card">ruta eco de {assignmentId}</section>
  ),
}));

vi.mock('../components/chat/ChatPanel.js', () => ({
  ChatPanel: (props: { assignmentId: string; title?: string; readOnly?: boolean }) => (
    <div
      data-testid="chat-panel"
      data-assignment-id={props.assignmentId}
      data-title={props.title ?? ''}
      data-readonly={String(props.readOnly ?? false)}
    />
  ),
}));

const resultadoSpy = vi.fn();
const descargarCertificadoSpy = vi.fn(async (_assignmentId: string) => undefined);
vi.mock('../services/assignment-resultado.js', () => ({
  getResultadoAsignacion: (...a: unknown[]) => resultadoSpy(...a),
  descargarCertificadoDeAsignacion: (id: string) => descargarCertificadoSpy(id),
}));

const apiGetSpy = vi.fn();
const apiPatchSpy = vi.fn();
vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: {
      ...actual.api,
      get: (...args: unknown[]) => apiGetSpy(...args),
      patch: (...args: unknown[]) => apiPatchSpy(...args),
    },
  };
});

const { ConductorDashboardRoute } = await import('./conductor.js');
const { ApiError } = await import('../lib/api-client.js');

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
    active_membership: {
      id: 'm-1',
      role: 'conductor',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'emp-c',
        legal_name: 'Transportes Demo Sur S.A.',
        rut: null,
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    },
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
  vehicle: { id: 'veh-1', plate: 'DEMO01', has_teltonika: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  reporterState = {
    isWatching: false,
    lastPosition: null,
    lastError: null,
    pointsSent: 0,
    lastGeofence: null,
    queued: 0,
    enSegundoPlano: false,
    avisoPausa: false,
    start: reporterStartSpy,
    stop: reporterStopSpy,
    flush: reporterFlushSpy,
  };
  reporterFlushSpy.mockClear();
  resultadoSpy.mockReset();
  descargarCertificadoSpy.mockClear();
  queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
  apiGetSpy.mockResolvedValue({ assignments: [] });
  ecoRouteState = {};
});

afterEach(() => {
  vi.restoreAllMocks();
  wakeWordFlag = false;
  wakeWordPreferido = false;
});

describe('ConductorDashboardRoute', () => {
  it('contexto no onboarded → no renderiza dashboard', () => {
    providedContext = { kind: 'unmanaged' };
    const { container } = render(<ConductorDashboardRoute />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('gate por rol: un dueño onboarded NO ve el panel del conductor, va a /app', () => {
    const me = makeMe();
    (me as unknown as { active_membership: { role: string } }).active_membership.role = 'dueno';
    providedContext = { kind: 'onboarded', me };
    render(<ConductorDashboardRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app');
    expect(screen.queryByText('Tu próximo servicio')).toBeNull();
  });

  it('header muestra full_name del usuario y link a configuración', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorDashboardRoute />);
    expect(screen.getByText('Pedro Conductor')).toBeInTheDocument();
    expect(screen.getByText('Conductor')).toBeInTheDocument();
    const cogLink = screen.getByTestId('link-configuracion-conductor');
    // El mock ahora mapea `to` → `href`, como hace el Link real.
    expect(cogLink).toHaveAttribute('href', '/app/conductor/configuracion');
  });

  it('iOS PWA: el header del conductor reserva el inset superior (pt-safe)', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorDashboardRoute />);
    expect(screen.getByRole('banner')).toHaveClass('pt-safe');
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

  it('sin Teltonika y por recoger, sin permiso: no hay botón de GPS y explica que arranca al recoger', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);
    // Antes: botón «Iniciar reporte GPS» deshabilitado + aviso de permisos. El
    // conductor no sabía si tocarlo o no (reporte del PO, 2026-09-14).
    expect(screen.queryByTestId('gps-start')).toBeNull();
    expect(
      screen.getByText(/Al confirmar la recogida, tu teléfono empezará a reportar/i),
    ).toBeInTheDocument();
    expect(reporterStartSpy).not.toHaveBeenCalled();
  });

  it('sin Teltonika, por recoger y permiso ya concedido: reporta solo (para el geofence), sin botón', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);
    await waitFor(() => expect(reporterStartSpy).toHaveBeenCalledWith(sampleAssignment.id));
    expect(screen.queryByTestId('gps-start')).toBeNull();
  });

  it('reportando: muestra el contador y NO ofrece detener (para al confirmar la entrega)', async () => {
    reporterState = { ...reporterState, isWatching: true, pointsSent: 42 };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText(/42 puntos enviados/)).toBeInTheDocument();
    expect(screen.getByText(/mientras esta pantalla está al frente/)).toBeInTheDocument();
    expect(screen.queryByTestId('gps-stop')).toBeNull();
  });

  it('tras Maps: dice que el reporte se pausó, no que venía enviando en vivo', async () => {
    reporterState = { ...reporterState, isWatching: true, pointsSent: 17, avisoPausa: true };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    expect(
      await screen.findByText(/El reporte se pausó al salir de esta pantalla\. Ya volvió a enviar/),
    ).toBeInTheDocument();
    expect(screen.getByText(/17 puntos enviados/)).toBeInTheDocument();
    expect(screen.getByTestId('aviso-maps-pausa')).toHaveTextContent(/Si abres Maps/);
  });

  it('con Teltonika: el camión reporta solo; ni botón ni watch del teléfono', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({
      assignments: [
        { ...sampleAssignment, vehicle: { id: 'veh-1', plate: 'JLKT54', has_teltonika: true } },
      ],
    });
    queryDriverPermissionsSpy.mockResolvedValue({ mic: 'granted', geo: 'granted' });
    render(<ConductorDashboardRoute />);
    expect(
      await screen.findByText(/Tu camión reporta la posición automáticamente/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('gps-start')).toBeNull();
    expect(screen.queryByTestId('aviso-maps-pausa')).toBeNull();
    expect(reporterStartSpy).not.toHaveBeenCalled();
  });

  it('sin Teltonika: confirmar la recogida arranca el reporte del teléfono', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true, already_picked_up: false });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByTestId('confirmar-recogida'));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await waitFor(() => expect(reporterStartSpy).toHaveBeenCalledWith(sampleAssignment.id));
  });

  it('en ruta sin posición: avisa y ofrece reintentar la ubicación', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    const retry = await screen.findByTestId('gps-retry');
    expect(screen.getByText(/No estamos recibiendo tu posición/i)).toBeInTheDocument();
    reporterStartSpy.mockClear();
    fireEvent.click(retry);
    expect(reporterStartSpy).toHaveBeenCalledWith(sampleAssignment.id);
  });

  it('con cola pendiente muestra cuántas posiciones esperan señal', async () => {
    reporterState = { ...reporterState, isWatching: true, pointsSent: 3, queued: 4 };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByText(/4 pendientes de envío/)).toBeInTheDocument();
  });

  it('confirmar la entrega DRENA la cola antes del PATCH (las posiciones sin señal cuentan)', async () => {
    reporterState = { ...reporterState, isWatching: true, pointsSent: 3, queued: 2 };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    const orden: string[] = [];
    reporterFlushSpy.mockImplementation(async () => {
      orden.push('flush');
      return { enviados: 2, restantes: 0 };
    });
    apiPatchSpy.mockImplementation(async () => {
      orden.push('patch');
      return { ok: true };
    });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar entrega$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await waitFor(() => expect(apiPatchSpy).toHaveBeenCalled());
    expect(orden).toEqual(['flush', 'patch']);
  });

  it('antes de entregar muestra la ruta eco sugerida (colapsable, reusa AssignmentEcoRouteCard)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    expect(await screen.findByTestId('assignment-eco-route-card')).toHaveTextContent(
      sampleAssignment.id,
    );
  });

  it('tras entregar muestra el resultado: kg CO2e, distancia, cobertura y línea de método (solo lectura)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    apiPatchSpy.mockResolvedValue({ ok: true });
    resultadoSpy.mockResolvedValue({
      assignment: {
        id: sampleAssignment.id,
        status: 'entregado',
        picked_up_at: '2026-09-14T16:44:36Z',
        delivered_at: '2026-09-14T17:01:57Z',
      },
      trip: { id: 'trip-1', tracking_code: 'BOO-ABC123' },
      metrics: {
        distance_km_estimated: '500.00',
        distance_km_actual: '2.51',
        carbon_emissions_kgco2e_estimated: '33.475',
        carbon_emissions_kgco2e_actual: '2.691',
        precision_method: 'modelado',
        glec_version: '3.0',
        route_data_source: 'teltonika_gps',
        coverage_pct: '100.00',
        certification_level: 'secundario_modeled',
        linea_metodo:
          'Distancia medida por GPS del vehículo (cobertura 100 %) · Consumo modelado según GLEC v3.0',
        certificate_pdf_url: 'gs://x',
        certificate_sha256: 'abc',
        certificate_kms_key_version: '1',
        certificate_issued_at: '2026-09-14T21:40:40Z',
      },
      certificate: {
        issued_at: '2026-09-14T21:40:40Z',
        sha256: 'abc',
        verify_url: 'https://api.boosterchile.com/certificates/BOO-ABC123/verify',
      },
    });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar entrega$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await screen.findByText(/kg CO2e/);
    const panel = screen.getByTestId('resultado-viaje');
    expect(panel).toHaveTextContent(/2,69 kg CO2e|2.69 kg CO2e/);
    expect(panel).toHaveTextContent(/2,5 km|2.5 km/);
    expect(panel).toHaveTextContent(/100 %/);
    expect(panel).toHaveTextContent(/Distancia medida por GPS del vehículo/);
    // Solo lectura: ningún botón de acción sobre el viaje además de la descarga.
    expect(screen.queryByRole('button', { name: /Confirmar/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Descargar certificado/i }));
    await waitFor(() => expect(descargarCertificadoSpy).toHaveBeenCalledWith(sampleAssignment.id));
  });

  it('tras entregar, mientras el certificado se emite, lo dice y no ofrece descargar', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    apiPatchSpy.mockResolvedValue({ ok: true });
    resultadoSpy.mockResolvedValue({
      assignment: {
        id: sampleAssignment.id,
        status: 'entregado',
        picked_up_at: null,
        delivered_at: '2026-09-14T17:01:57Z',
      },
      trip: { id: 'trip-1', tracking_code: 'BOO-ABC123' },
      metrics: {
        distance_km_estimated: '500.00',
        distance_km_actual: null,
        carbon_emissions_kgco2e_estimated: '33.475',
        carbon_emissions_kgco2e_actual: null,
        precision_method: 'modelado',
        glec_version: '3.0',
        route_data_source: 'maps_directions',
        coverage_pct: '0.00',
        certification_level: 'secundario_modeled',
        linea_metodo:
          'Distancia estimada por ruta (Google Routes) · Consumo modelado según GLEC v3.0',
        certificate_pdf_url: null,
        certificate_sha256: null,
        certificate_kms_key_version: null,
        certificate_issued_at: null,
      },
      certificate: null,
    });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar entrega$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await screen.findByText(/Certificado en proceso/i);
    const panel = screen.getByTestId('resultado-viaje');
    expect(panel).toHaveTextContent(/Certificado en proceso/i);
    expect(panel).toHaveTextContent(/estimad/i);
    expect(screen.queryByRole('button', { name: /Descargar certificado/i })).toBeNull();
  });

  it('confirmar la entrega detiene el reporte del teléfono', async () => {
    reporterState = { ...reporterState, isWatching: true, pointsSent: 7 };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    apiPatchSpy.mockResolvedValue({ ok: true });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar entrega$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await waitFor(() => expect(reporterStopSpy).toHaveBeenCalled());
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

// ---------------------------------------------------------------------------
// Auditoría 2026-08-01 — lo que el conductor necesita para hacer su trabajo
// ---------------------------------------------------------------------------
// El dashboard mostraba el servicio pero no dejaba operarlo: sin navegación al
// destino y sin forma de confirmar la entrega. La única salida era un link a
// `/app/asignaciones/$id`, pantalla del TRANSPORTISTA — el conductor pasa su
// gate (su empresa es transportista) y termina viendo herramientas de su jefe:
// "asignar conductor" y el factoring de Cobra hoy.
describe('ConductorDashboardRoute — acciones del servicio', () => {
  it('por recoger: ofrece ir al ORIGEN, no al destino', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    const nav = await screen.findByTestId('navegar-origen');
    // Antes de recoger, el conductor va al origen. «Navegar al destino» acá
    // confundía (reporte del PO, 2026-09-14). El botón principal se queda en
    // esta pantalla: Maps es el enlace secundario, con el aviso de pausa.
    expect(nav.tagName).toBe('BUTTON');
    expect(nav).not.toHaveAttribute('href');
    expect(screen.queryByTestId('navegar-destino')).toBeNull();
    const maps = screen.getByTestId('abrir-maps-origen');
    expect(maps.getAttribute('href') ?? '').toContain(encodeURIComponent('Av. Pajaritos 1234'));
    expect(maps).toHaveTextContent(/pausa el reporte GPS/);
  });

  it('«Ir al destino» abre la ruta en la pantalla y no sale a Maps', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    ecoRouteState = { data: { polyline_encoded: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    const nav = await screen.findByTestId('navegar-destino');
    expect(nav.tagName).toBe('BUTTON');
    expect(nav).not.toHaveAttribute('href');
    expect(screen.queryByTestId('ruta-en-app')).toBeNull();
    fireEvent.click(nav);
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByTestId('ruta-en-app')).toBeInTheDocument();
    expect(screen.getByTestId('eco-route-map')).toHaveTextContent('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    const maps = screen.getByTestId('abrir-maps-destino');
    expect(maps).toHaveTextContent('Abrir en Maps (pausa el reporte GPS)');
    expect(screen.queryByRole('link', { name: /^Ir al destino$/ })).toBeNull();
  });

  it('con ruta eco: Maps (secundario) va a las COORDENADAS del destino, no al texto', async () => {
    // Polyline de ejemplo de Google: (38.5,-120.2) → (40.7,-120.95) → (43.252,-126.453).
    ecoRouteState = { data: { polyline_encoded: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    const maps = await screen.findByTestId('abrir-maps-destino');
    const href = maps.getAttribute('href') ?? '';
    expect(href).toContain(`destination=${encodeURIComponent('43.252,-126.453')}`);
    expect(href).not.toContain(encodeURIComponent('Av. Brasil 2345'));
    expect(href).toContain('travelmode=driving');
    expect(screen.getByTestId('navegar-destino').tagName).toBe('BUTTON');
  });

  it('con ruta eco: Maps del origen va a las coordenadas del origen', async () => {
    ecoRouteState = { data: { polyline_encoded: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' } };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    const maps = await screen.findByTestId('abrir-maps-origen');
    expect(maps.getAttribute('href') ?? '').toContain(
      `destination=${encodeURIComponent('38.5,-120.2')}`,
    );
    expect(screen.getByTestId('navegar-origen').tagName).toBe('BUTTON');
  });

  it('sin ruta eco: Maps cae al texto de la dirección y el panel lo dice', async () => {
    ecoRouteState = { data: { polyline_encoded: null } };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    const href = (await screen.findByTestId('abrir-maps-origen')).getAttribute('href') ?? '';
    expect(href).toContain(encodeURIComponent('Av. Pajaritos 1234'));
    expect(href).toContain('travelmode=driving');
    fireEvent.click(screen.getByTestId('navegar-origen'));
    expect(await screen.findByTestId('ruta-en-app-sin-dibujo')).toHaveTextContent(
      'Av. Pajaritos 1234',
    );
    expect(screen.queryByTestId('eco-route-map')).toBeNull();
  });

  it('mientras carga la ruta, el panel no dice que no hay dibujo', async () => {
    ecoRouteState = { isPending: true };
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByTestId('navegar-origen'));
    expect(await screen.findByTestId('ruta-en-app-cargando')).toBeInTheDocument();
    expect(screen.queryByTestId('ruta-en-app-sin-dibujo')).toBeNull();
    expect(screen.queryByTestId('eco-route-map')).toBeNull();
  });

  it('en ruta: ofrece ir al destino dentro de la pantalla', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    const nav = await screen.findByTestId('navegar-destino');
    expect(nav.tagName).toBe('BUTTON');
    expect(nav).toHaveTextContent(/Ir al destino/);
    expect(screen.queryByTestId('navegar-origen')).toBeNull();
    const maps = screen.getByTestId('abrir-maps-destino');
    expect(maps.getAttribute('href') ?? '').toContain(encodeURIComponent('Av. Brasil 2345'));
    expect(maps).toHaveTextContent(/pausa el reporte GPS/);
  });

  it('con Teltonika: Maps no dice que pausa el GPS del teléfono', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({
      assignments: [
        {
          ...sampleAssignment,
          status: 'recogido',
          vehicle: { id: 'veh-1', plate: 'JLKT54', has_teltonika: true },
        },
      ],
    });
    render(<ConductorDashboardRoute />);
    const maps = await screen.findByTestId('abrir-maps-destino');
    expect(maps).toHaveTextContent('Abrir en Maps');
    expect(maps).not.toHaveTextContent(/pausa el reporte GPS/);
    expect(screen.getByTestId('navegar-destino').tagName).toBe('BUTTON');
  });

  it('permite confirmar la entrega desde su propia pantalla', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true });

    render(<ConductorDashboardRoute />);

    const btn = await screen.findByRole('button', { name: /Confirmar entrega/i });
    fireEvent.click(btn);
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-entrega`,
      ),
    );
  });

  it('pide confirmación inline antes de marcar la entrega; «No» cancela sin PATCH', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [{ ...sampleAssignment, status: 'recogido' }] });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /^Confirmar entrega$/i })); // sin confirmar
    // Es una acción irreversible en la operación: no puede dispararse por un
    // toque accidental con el celular en el bolsillo. Y sin window.confirm:
    // en la PWA de iOS salía como diálogo del sistema, sin estilo ni control.
    const franja = await screen.findByTestId('confirmacion-inline');
    expect(franja).toHaveTextContent(/¿Confirmas que entregaste esta carga\?/);
    expect(apiPatchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^No$/i }));
    expect(screen.queryByTestId('confirmacion-inline')).toBeNull();
    expect(apiPatchSpy).not.toHaveBeenCalled();
  });

  // Hallazgo del e2e contra API real (2026-08-02): con
  // REQUIRE_DOCUMENT_TO_CLOSE=true (default, config.ts) el cierre devuelve
  // 409 documento_requerido mientras el viaje no tenga guía/factura subida.
  // El conductor NO puede subirla —`requireWriteRole` exige dueno|admin|
  // despachador— así que un mensaje genérico lo deja golpeando el botón
  // contra una pared. La UI tiene que nombrar el bloqueo y a quién pedírselo.
  it('409 documento_requerido → dice qué falta y quién lo resuelve', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new ApiError(409, 'documento_requerido', {}));

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/documento|guía|guia|factura/i);
    // Nunca culpar a la señal: el request llegó y el backend contestó.
    expect(alerta.textContent ?? '').not.toMatch(/señal|senal/i);
  });

  it('409 ted_no_decodificado → pide esperar, no reintentar a ciegas', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new ApiError(409, 'ted_no_decodificado', {}));

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/procesando|minutos/i);
    expect(alerta.textContent ?? '').not.toMatch(/señal|senal/i);
  });

  it('caída de red sí culpa a la señal', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/señal|conexión/i);
  });

  it('ya entregada (409 invalid_status) no queda como error del conductor', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(
      new ApiError(409, 'invalid_status', { current_status: 'entregado' }),
    );

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/ya .*(entregad|cerrad)/i);
  });

  // El paso `asignado → recogido` estaba modelado en la máquina de estados
  // desde 2026-06 y NADIE lo escribía. Sin él, la pantalla de Servicios del
  // despachador decía «Por recoger» para un camión ya en ruta, y el
  // consignatario no veía posición en su link de tracking.
  it('con el servicio asignado ofrece confirmar la recogida', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true, already_picked_up: false });

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-recogida`,
      ),
    );
  });

  it('pide confirmación inline antes de marcar la recogida; «No» cancela sin PATCH', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i })); // sin confirmar
    const franja = await screen.findByTestId('confirmacion-inline');
    expect(franja).toHaveTextContent(/¿Confirmas que ya cargaste esta carga en el camión\?/);
    expect(apiPatchSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^No$/i }));
    expect(screen.queryByTestId('confirmacion-inline')).toBeNull();
    expect(apiPatchSpy).not.toHaveBeenCalled();
  });

  it('ya recogido → no vuelve a ofrecerlo, y la entrega sigue disponible', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({
      assignments: [{ ...sampleAssignment, status: 'recogido' }],
    });
    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);

    expect(screen.queryByRole('button', { name: /Confirmar recogida/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Confirmar entrega/i })).toBeInTheDocument();
  });

  it('la entrega NO exige haber confirmado la recogida', async () => {
    // Bloquear el cierre por un botón olvidado castigaría al conductor en
    // terreno: llegaría a destino con la carga entregada y la app le diría
    // que no puede cerrar. La tabla de transiciones ya permite
    // asignado → entregado.
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true });

    render(<ConductorDashboardRoute />);
    const entrega = await screen.findByRole('button', { name: /Confirmar entrega/i });
    expect(entrega).not.toBeDisabled();
    fireEvent.click(entrega);
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-entrega`,
      ),
    );
  });

  // T9 (medicion-huella-segmento): disparo híbrido. El geofence del origen
  // (evaluado en el API con cada posición reportada) SUGIERE la recogida; el
  // conductor confirma con un tap y viaja `picked_up_at` = instante del cruce.
  it('dentro del geofence del origen → sugiere la recogida y el tap manda picked_up_at del cruce', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true, already_picked_up: false });
    const cruce = '2026-08-02T09:30:00.000Z';
    reporterState = {
      ...reporterState,
      isWatching: true,
      pointsSent: 3,
      lastGeofence: { estado: 'dentro', distanciaM: 40, at: cruce },
    };

    render(<ConductorDashboardRoute />);

    const sugerencia = await screen.findByTestId('sugerencia-recogida');
    expect(sugerencia.textContent ?? '').toMatch(/punto de recogida/i);
    fireEvent.click(screen.getByRole('button', { name: /Confirmar recogida/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-recogida`,
        { picked_up_at: cruce },
      ),
    );
  });

  it('origen sin geocodificar (sin_origen) → no sugiere, pero el tap manual sigue disponible sin body', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true, already_picked_up: false });
    reporterState = {
      ...reporterState,
      isWatching: true,
      lastGeofence: { estado: 'sin_origen', distanciaM: null, at: '2026-08-02T09:30:00.000Z' },
    };

    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);

    expect(screen.queryByTestId('sugerencia-recogida')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar recogida/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-recogida`,
      ),
    );
  });

  it('recogida fallida → mensaje accionable, sin culpar a la señal si el backend contestó', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new ApiError(409, 'invalid_status', {}));

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').not.toMatch(/señal|senal/i);
  });

  it('NO manda al conductor a la pantalla del transportista', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);

    const links = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links.some((h) => h?.includes('/app/asignaciones/'))).toBe(false);
  });
});

describe('ConductorDashboardRoute — chat in-app del viaje', () => {
  it('con servicio asignado ofrece chat con el generador (mismo ChatPanel)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);
    const btn = await screen.findByTestId('abrir-chat-viaje');
    expect(btn).toHaveAttribute('aria-label', 'Abrir chat con el generador de carga');
    fireEvent.click(btn);
    const panel = screen.getByTestId('chat-panel');
    expect(panel).toHaveAttribute('data-assignment-id', sampleAssignment.id);
    expect(panel).toHaveAttribute('data-readonly', 'false');
  });

  it('tras entregar el chat queda read-only', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({
      assignments: [{ ...sampleAssignment, status: 'recogido' }],
    });
    apiPatchSpy.mockResolvedValue({});
    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByTestId('confirmar-entrega'));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, confirmar/i }));
    await waitFor(() => expect(apiPatchSpy).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('abrir-chat-viaje'));
    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-readonly', 'true');
  });

  it('sin servicios no hay chat', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    render(<ConductorDashboardRoute />);
    await screen.findByText(/No tienes servicios asignados/i);
    expect(screen.queryByTestId('abrir-chat-viaje')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Auditoría 2026-08-01 — P1 del dashboard
// ---------------------------------------------------------------------------
describe('ConductorDashboardRoute — mantenerse al día', () => {
  it('ofrece actualizar la lista sin recargar la app', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    render(<ConductorDashboardRoute />);
    await screen.findByText(/No tienes servicios asignados/i);

    // Un servicio despachado con la pantalla abierta no aparecía nunca: el
    // fetch era único en mount y el conductor tenía que saber recargar.
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/i }));

    expect(await screen.findByTestId(`assignment-card-${sampleAssignment.id}`)).toBeInTheDocument();
  });

  it('un fallo del servidor se explica en lenguaje del conductor', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    const { ApiError } = await import('../lib/api-client.js');
    apiGetSpy.mockRejectedValue(new ApiError(500, 'boom', null));
    render(<ConductorDashboardRoute />);

    const alerta = await screen.findByRole('alert');
    // Antes mostraba `Error 500: boom` — ruido inútil para quien está en ruta.
    expect(alerta.textContent ?? '').not.toMatch(/Error 500|boom/);
    expect(alerta.textContent ?? '').toMatch(/intenta|señal|nuevamente/i);
  });

  it('si no se puede leer el permiso de GPS, no queda un botón muerto: explica que arranca al recoger', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockRejectedValue(new Error('permissions API no disponible'));
    render(<ConductorDashboardRoute />);
    expect(
      await screen.findByText(/Al confirmar la recogida, tu teléfono empezará a reportar/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('gps-start')).toBeNull();
  });

  it('mientras actualiza, el botón lo dice (no parece muerto)', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    render(<ConductorDashboardRoute />);
    await screen.findByText(/No tienes servicios asignados/i);
    let resolver: ((v: unknown) => void) | undefined;
    apiGetSpy.mockReturnValueOnce(
      new Promise((r) => {
        resolver = r;
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Actualizar$/i }));
    // El PO tocó «Actualizar» y «no funcionó»: sí recargaba, pero sin ninguna
    // señal visible (7 GET /me/assignments en el log, 2026-09-14).
    expect(await screen.findByRole('button', { name: /Actualizando/i })).toBeDisabled();
    resolver?.({ assignments: [] });
    expect(await screen.findByRole('button', { name: /^Actualizar$/i })).not.toBeDisabled();
  });
});

describe('ConductorDashboardRoute — el wake-word no miente sobre el micrófono', () => {
  it('con el flag ON y la preferencia activa, NO afirma que está escuchando', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [] });
    wakeWordFlag = true;
    wakeWordPreferido = true;

    render(<ConductorDashboardRoute />);
    const banner = await screen.findByTestId('wake-word-active-banner');

    // El controller es un stub declarado (`services/wake-word.ts`): no toca el
    // micrófono. Decirle al conductor "Escuchando" es una afirmación falsa
    // sobre su privacidad — la peor clase de placebo.
    expect(banner.textContent ?? '').not.toMatch(/escuchando/i);
    expect(banner.textContent ?? '').toMatch(/pronto|disponible|preparando/i);
  });
});

describe('ConductorDashboardRoute — accesibilidad', () => {
  it('no tiene violaciones de a11y con un servicio asignado (vitest-axe)', async () => {
    const { axe } = await import('vitest-axe');
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });

    const { baseElement } = render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);

    // color-contrast off: jsdom no computa layout/canvas (lo cubre ui-tokens).
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
