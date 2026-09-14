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
type GeofenceLectura = import('../hooks/use-driver-position-reporter.js').GeofenceLectura;
let reporterState = {
  isWatching: false,
  lastPosition: null as { latitude: number; longitude: number; timestamp: string } | null,
  lastError: null as string | null,
  pointsSent: 0,
  lastGeofence: null as GeofenceLectura | null,
  start: reporterStartSpy,
  stop: reporterStopSpy,
};

vi.mock('../hooks/use-driver-position-reporter.js', () => ({
  useDriverPositionReporter: () => reporterState,
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
    lastGeofence: null,
    start: reporterStartSpy,
    stop: reporterStopSpy,
  };
  queryDriverPermissionsSpy.mockResolvedValue({ mic: 'prompt', geo: 'prompt' });
  apiGetSpy.mockResolvedValue({ assignments: [] });
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

  it('header muestra full_name del usuario y link a configuración', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    render(<ConductorDashboardRoute />);
    expect(screen.getByText('Pedro Conductor')).toBeInTheDocument();
    expect(screen.getByText('Conductor')).toBeInTheDocument();
    const cogLink = screen.getByTestId('link-configuracion-conductor');
    // El mock ahora mapea `to` → `href`, como hace el Link real.
    expect(cogLink).toHaveAttribute('href', '/app/conductor/configuracion');
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

// ---------------------------------------------------------------------------
// Auditoría 2026-08-01 — lo que el conductor necesita para hacer su trabajo
// ---------------------------------------------------------------------------
// El dashboard mostraba el servicio pero no dejaba operarlo: sin navegación al
// destino y sin forma de confirmar la entrega. La única salida era un link a
// `/app/asignaciones/$id`, pantalla del TRANSPORTISTA — el conductor pasa su
// gate (su empresa es transportista) y termina viendo herramientas de su jefe:
// "asignar conductor" y el factoring de Cobra hoy.
describe('ConductorDashboardRoute — acciones del servicio', () => {
  it('ofrece navegación al destino', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    render(<ConductorDashboardRoute />);

    const nav = await screen.findByTestId('navegar-destino');
    // Un conductor necesita abrir el destino en su app de mapas, no copiarlo.
    expect(nav.getAttribute('href') ?? '').toMatch(/maps|geo:/i);
    expect(nav.getAttribute('href') ?? '').toContain(encodeURIComponent('Av. Brasil 2345'));
  });

  it('permite confirmar la entrega desde su propia pantalla', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);

    const btn = await screen.findByRole('button', { name: /Confirmar entrega/i });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-entrega`,
      ),
    );
  });

  it('pide confirmación antes de marcar la entrega', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));

    // Es una acción irreversible en la operación: no puede dispararse por un
    // toque accidental con el celular en el bolsillo.
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/documento|guía|guia|factura/i);
    // Nunca culpar a la señal: el request llegó y el backend contestó.
    expect(alerta.textContent ?? '').not.toMatch(/señal|senal/i);
  });

  it('409 ted_no_decodificado → pide esperar, no reintentar a ciegas', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new ApiError(409, 'ted_no_decodificado', {}));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/procesando|minutos/i);
    expect(alerta.textContent ?? '').not.toMatch(/señal|senal/i);
  });

  it('caída de red sí culpa a la señal', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(new TypeError('Failed to fetch'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/señal|conexión/i);
  });

  it('ya entregada (409 invalid_status) no queda como error del conductor', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    apiPatchSpy.mockRejectedValue(
      new ApiError(409, 'invalid_status', { current_status: 'entregado' }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar entrega/i }));

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i }));

    await waitFor(() =>
      expect(apiPatchSpy).toHaveBeenCalledWith(
        `/assignments/${sampleAssignment.id}/confirmar-recogida`,
      ),
    );
  });

  it('pide confirmación antes de marcar la recogida', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i }));

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    const entrega = await screen.findByRole('button', { name: /Confirmar entrega/i });
    expect(entrega).not.toBeDisabled();
    fireEvent.click(entrega);

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    reporterState = {
      ...reporterState,
      isWatching: true,
      lastGeofence: { estado: 'sin_origen', distanciaM: null, at: '2026-08-02T09:30:00.000Z' },
    };

    render(<ConductorDashboardRoute />);
    await screen.findByTestId(`assignment-card-${sampleAssignment.id}`);

    expect(screen.queryByTestId('sugerencia-recogida')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirmar recogida/i }));
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ConductorDashboardRoute />);
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar recogida/i }));

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

  it('si no se puede leer el permiso de GPS, lo dice en vez de dejar el botón muerto', async () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    apiGetSpy.mockResolvedValue({ assignments: [sampleAssignment] });
    queryDriverPermissionsSpy.mockRejectedValue(new Error('permissions API no disponible'));
    render(<ConductorDashboardRoute />);

    // El `.catch(() => undefined)` dejaba el botón de GPS deshabilitado para
    // siempre, sin ninguna explicación.
    expect(
      await screen.findByText(/permiso de ubicación|activar la ubicación/i),
    ).toBeInTheDocument();
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
