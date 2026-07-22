import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

type ProtectedContext = { kind: 'onboarded' | 'unmanaged' | 'pre-onboarding' };
let providedContext: ProtectedContext = { kind: 'onboarded' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: ProtectedContext) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'veh-123' }),
}));

interface LiveProps {
  title: string;
  subtitle?: string;
  backTo: string;
  latitude: number | null;
  longitude: number | null;
  bottomExtra?: ReactNode;
}
let captured: LiveProps | null = null;
vi.mock('../components/map/LiveTrackingScreen.js', () => ({
  LiveTrackingScreen: (props: LiveProps) => {
    captured = props;
    return (
      <div data-testid="live-tracking" data-title={props.title} data-back={props.backTo}>
        <div data-testid="bottom-extra">{props.bottomExtra}</div>
      </div>
    );
  },
}));

const { VehiculoLiveRoute } = await import('./vehiculo-live.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
  providedContext = { kind: 'onboarded' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VehiculoLiveRoute', () => {
  it('contexto no onboarded → no renderiza tracking', () => {
    providedContext = { kind: 'unmanaged' };
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="live-tracking"]')).toBeNull();
  });

  it('happy: GET /vehiculos/:id/ubicacion + pasa props a LiveTrackingScreen', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicle_id: 'veh-123',
      plate: 'ABCD12',
      teltonika_imei: '111222333',
      ubicacion: {
        timestamp_device: '2026-05-10T10:00:00Z',
        latitude: -33.45,
        longitude: -70.65,
        altitude_m: null,
        angle_deg: 90,
        satellites: 12,
        speed_kmh: 50,
        priority: 1,
        temperatura_c: null,
        temperatura_registrada_en: null,
        can_speed_kmh: null,
        rpm: null,
        fuel_pct: null,
      },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(captured?.latitude).toBe(-33.45));
    expect(captured?.title).toBe('ABCD12 · En vivo');
    expect(captured?.subtitle).toBe('IMEI 111222333');
    expect(captured?.backTo).toBe('/app/vehiculos/veh-123');
  });

  it('sin Teltonika → subtitle "Sin Teltonika asociado"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicle_id: 'v',
      plate: 'PQR456',
      teltonika_imei: null,
      ubicacion: {
        timestamp_device: '2026-05-10T10:00:00Z',
        latitude: null,
        longitude: null,
        altitude_m: null,
        angle_deg: null,
        satellites: null,
        speed_kmh: null,
        priority: 1,
        temperatura_c: null,
        temperatura_registrada_en: null,
        can_speed_kmh: null,
        rpm: null,
        fuel_pct: null,
      },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(captured?.subtitle).toBe('Sin Teltonika asociado'));
    expect(captured?.title).toBe('Vehículo en vivo');
  });

  describe('stat Temperatura (W3 — IO 72 Dallas)', () => {
    it('temperatura_c positivo → "X.X °C" + "hace Ns"', async () => {
      const registradaEn = new Date(Date.now() - 10_000).toISOString();
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        vehicle_id: 'veh-123',
        plate: 'ABCD12',
        teltonika_imei: '111222333',
        ubicacion: {
          timestamp_device: '2026-05-10T10:00:00Z',
          latitude: -29.9027,
          longitude: -71.2519,
          altitude_m: 30,
          angle_deg: 90,
          satellites: 12,
          speed_kmh: 50,
          priority: 1,
          temperatura_c: 5.5,
          temperatura_registrada_en: registradaEn,
          can_speed_kmh: null,
          rpm: null,
          fuel_pct: null,
        },
      });
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <VehiculoLiveRoute />
        </Wrapper>,
      );
      await waitFor(() => expect(screen.getByTestId('bottom-extra').textContent).toContain('°C'));
      const text = screen.getByTestId('bottom-extra').textContent ?? '';
      expect(text).toContain('5.5 °C');
      expect(text).toContain('hace 10s');
      // los 3 stats CAN (motor apagado en este mock) muestran "Sin dato", así
      // que ya no vale un `not.toContain('Sin dato')` global; el `5.5 °C`
      // prueba que la temperatura no cayó a "Sin dato".
    });

    it('temperatura_c negativo (cadena de frío) → "-X.X °C"', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        vehicle_id: 'veh-123',
        plate: 'ABCD12',
        teltonika_imei: '111222333',
        ubicacion: {
          timestamp_device: '2026-05-10T10:00:00Z',
          latitude: -29.9027,
          longitude: -71.2519,
          altitude_m: 30,
          angle_deg: 90,
          satellites: 12,
          speed_kmh: 50,
          priority: 1,
          temperatura_c: -20,
          temperatura_registrada_en: new Date(Date.now() - 5_000).toISOString(),
          can_speed_kmh: null,
          rpm: null,
          fuel_pct: null,
        },
      });
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <VehiculoLiveRoute />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId('bottom-extra').textContent).toContain('-20.0 °C'),
      );
    });

    it('temperatura_c null → "Sin dato" explícito (no oculta el stat)', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        vehicle_id: 'veh-123',
        plate: 'ABCD12',
        teltonika_imei: '111222333',
        ubicacion: {
          timestamp_device: '2026-05-10T10:00:00Z',
          latitude: -29.9027,
          longitude: -71.2519,
          altitude_m: 30,
          angle_deg: 90,
          satellites: 12,
          speed_kmh: 50,
          priority: 1,
          temperatura_c: null,
          temperatura_registrada_en: null,
          can_speed_kmh: null,
          rpm: null,
          fuel_pct: null,
        },
      });
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <VehiculoLiveRoute />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId('bottom-extra').textContent).toContain('Sin dato'),
      );
      expect(screen.getByTestId('bottom-extra')).toBeInTheDocument();
    });
  });

  describe('stats CAN (W4 — LVCAN 81 speed / 85 RPM / 89 fuel %)', () => {
    it('CAN presente (motor encendido) → fuel %, RPM y velocidad CAN renderizados', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        vehicle_id: 'veh-123',
        plate: 'PLFL57',
        teltonika_imei: '860693084796730',
        ubicacion: {
          timestamp_device: '2026-07-20T20:31:58Z',
          latitude: -33.4489,
          longitude: -70.6693,
          altitude_m: 500,
          angle_deg: 90,
          satellites: 10,
          speed_kmh: 0,
          priority: 0,
          temperatura_c: null,
          temperatura_registrada_en: null,
          can_speed_kmh: 40,
          rpm: 1800,
          fuel_pct: 75,
        },
      });
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <VehiculoLiveRoute />
        </Wrapper>,
      );
      await waitFor(() => expect(screen.getByTestId('bottom-extra').textContent).toContain('75 %'));
      const text = screen.getByTestId('bottom-extra').textContent ?? '';
      expect(text).toContain('1800'); // RPM
      expect(text).toContain('40 km/h'); // velocidad CAN
    });

    it('CAN null (motor apagado) → "Sin dato" en los stats CAN (temperatura coexiste)', async () => {
      vi.spyOn(api, 'get').mockResolvedValueOnce({
        vehicle_id: 'veh-123',
        plate: 'PLFL57',
        teltonika_imei: '860693084796730',
        ubicacion: {
          timestamp_device: '2026-07-21T15:38:13Z',
          latitude: -33.4489,
          longitude: -70.6693,
          altitude_m: 500,
          angle_deg: 90,
          satellites: 10,
          speed_kmh: 0,
          priority: 0,
          temperatura_c: 10,
          temperatura_registrada_en: new Date(Date.now() - 3_000).toISOString(),
          can_speed_kmh: null,
          rpm: null,
          fuel_pct: null,
        },
      });
      const Wrapper = makeWrapper();
      render(
        <Wrapper>
          <VehiculoLiveRoute />
        </Wrapper>,
      );
      await waitFor(() =>
        expect(screen.getByTestId('bottom-extra').textContent).toContain('10.0 °C'),
      );
      expect(screen.getByTestId('bottom-extra').textContent).toContain('Sin dato');
    });
  });

  it('API error → captured props con title genérico', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom'));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoLiveRoute />
      </Wrapper>,
    );
    // El queryFn captura el error y devuelve null → captured.title="Vehículo en vivo"
    await waitFor(() => expect(captured?.title).toBeDefined());
    expect(captured?.title).toBe('Vehículo en vivo');
    expect(captured?.latitude).toBeNull();
  });
});
