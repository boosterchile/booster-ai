import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  Link: ({ children }: { children: ReactNode }) => <a href="#stub">{children}</a>,
}));

// Capturar los points pasados al mapa (evita cargar Google Maps en jsdom).
let capturedPoints: Array<{ lat: number; lng: number }> | null = null;
vi.mock('../components/map/TrazaMapPreview.js', () => ({
  TrazaMapPreview: (props: { points: Array<{ lat: number; lng: number }> }) => {
    capturedPoints = props.points;
    return <div data-testid="traza-map" data-count={props.points.length} />;
  },
}));

const { VehiculoHistorialRoute } = await import('./vehiculo-historial.js');

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const trazaConCan = {
  vehicle_id: 'veh-123',
  plate: 'PLFL57',
  desde: '2026-07-14T00:00:00Z',
  hasta: '2026-07-22T23:59:59Z',
  puntos: [
    { t: '2026-07-14T10:00:00Z', lat: -33.4, lng: -70.6 },
    { t: '2026-07-20T18:00:00Z', lat: -33.5, lng: -70.62 },
  ],
  puntos_total: 9497,
  puntos_devueltos: 2,
  resumen: { distancia_km: 12.3, duracion_min: 125, litros_consumidos: 391.5, km_can: 993.8 },
};

beforeEach(() => {
  vi.clearAllMocks();
  capturedPoints = null;
  providedContext = { kind: 'onboarded' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VehiculoHistorialRoute', () => {
  it('contexto no onboarded → no renderiza la traza', () => {
    providedContext = { kind: 'unmanaged' };
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    expect(container.querySelector('[data-testid="traza-map"]')).toBeNull();
  });

  it('con traza + CAN → resumen (distancia, litros, km, duración) + points al mapa', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(trazaConCan);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('traza-resumen').textContent).toContain('12.3 km'),
    );
    const text = screen.getByTestId('traza-resumen').textContent ?? '';
    expect(text).toContain('391.5 L'); // litros (Δ83)
    expect(text).toContain('993.8 km'); // km CAN (Δ87)
    expect(text).toContain('2 h 5 min'); // 125 min
    await waitFor(() => expect(capturedPoints).toHaveLength(2));
    expect(capturedPoints?.[0]).toEqual({ lat: -33.4, lng: -70.6 });
  });

  it('filtros son datetime-local y la query respeta la hora (no solo el día)', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue(trazaConCan);
    const Wrapper = makeWrapper();
    const { container } = render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(getSpy).toHaveBeenCalled());

    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]');
    expect(inputs).toHaveLength(2); // Desde + Hasta, con hora

    // Cambiar "Desde" a una hora concreta → la query lleva esa hora exacta.
    const desde = inputs[0];
    if (!desde) {
      throw new Error('input Desde no encontrado');
    }
    fireEvent.change(desde, { target: { value: '2026-07-15T08:30' } });
    // Round-trip con el mismo `new Date` que usa el componente → TZ-agnóstico.
    const esperadoIso = new Date('2026-07-15T08:30').toISOString();
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([u]) => typeof u === 'string' && u.includes(encodeURIComponent(esperadoIso)),
        ),
      ).toBe(true),
    );
    // La hora 08:30 no es medianoche → prueba que no se cayó a granularidad de día.
    expect(esperadoIso).not.toContain('T00:00:00');
  });

  it('resumen etiqueta la duración como "En movimiento" (no span)', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(trazaConCan);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('traza-resumen').textContent).toContain('12.3 km'),
    );
    expect(screen.getByTestId('traza-resumen').textContent).toContain('En movimiento');
  });

  it('sin CAN → combustible y km "Sin dato"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      ...trazaConCan,
      resumen: { distancia_km: 5.0, duracion_min: 30, litros_consumidos: null, km_can: null },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('traza-resumen').textContent).toContain('5.0 km'),
    );
    expect(screen.getByTestId('traza-resumen').textContent).toContain('Sin dato');
  });

  it('error del endpoint → mensaje de error, no rompe', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom'));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <VehiculoHistorialRoute />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByTestId('traza-error')).toBeInTheDocument());
  });
});
