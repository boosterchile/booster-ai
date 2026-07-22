import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';

// Captura props del mapa (evita Google Maps en jsdom); mide real + esperada.
let captured: { points: unknown[]; expectedRoute?: unknown[] } | null = null;
vi.mock('../map/TrazaMapPreview.js', () => ({
  TrazaMapPreview: (props: { points: unknown[]; expectedRoute?: unknown[] }) => {
    captured = props;
    return (
      <div
        data-testid="traza-map"
        data-real={props.points.length}
        data-exp={props.expectedRoute?.length ?? 0}
      />
    );
  },
}));

const { TrazaCargaCard } = await import('./TrazaCargaCard.js');

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

// Polyline de referencia (Google docs): 3 puntos.
const VALID_POLYLINE = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

const conDatos = {
  assignment_id: 'a1',
  plate: 'PLFL57',
  delivered: true,
  puntos: [
    { t: '2026-07-14T10:00:00Z', lat: -33.4, lng: -70.6 },
    { t: '2026-07-20T18:00:00Z', lat: -33.5, lng: -70.62 },
  ],
  puntos_total: 100,
  puntos_devueltos: 2,
  ruta_esperada_polyline: VALID_POLYLINE,
  resumen: {
    distancia_real_km: 12.3,
    distancia_esperada_km: 15.0,
    duracion_min: 60,
    cobertura_pct: 82,
    litros_consumidos: 391.5,
    km_can: 993.8,
  },
};

function expand() {
  fireEvent.click(screen.getByTestId('traza-carga-toggle'));
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrazaCargaCard', () => {
  it('collapsed por default → no fetchea ni muestra el body', () => {
    const spy = vi.spyOn(api, 'get');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TrazaCargaCard assignmentId="a1" />
      </Wrapper>,
    );
    expect(screen.queryByTestId('traza-carga-body')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('expand → fetch → resumen (real/esperada/cobertura/CAN) + mapa real+esperada', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce(conDatos);
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TrazaCargaCard assignmentId="a1" />
      </Wrapper>,
    );
    expand();
    await waitFor(() =>
      expect(screen.getByTestId('traza-carga-resumen').textContent).toContain('12.3 km'),
    );
    const text = screen.getByTestId('traza-carga-resumen').textContent ?? '';
    expect(text).toContain('15.0 km'); // esperada
    expect(text).toContain('82 %'); // cobertura
    expect(text).toContain('391.5 L'); // litros
    expect(text).toContain('993.8 km'); // km CAN
    // Mapa recibe traza real (2) + ruta esperada decodeada (3 puntos).
    await waitFor(() => expect(captured?.points).toHaveLength(2));
    expect(captured?.expectedRoute).toHaveLength(3);
  });

  it('sin telemetría (puntos_total 0) → aviso + CAN "Sin dato"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      ...conDatos,
      puntos: [],
      puntos_total: 0,
      puntos_devueltos: 0,
      ruta_esperada_polyline: null,
      resumen: {
        distancia_real_km: 0,
        distancia_esperada_km: null,
        duracion_min: 0,
        cobertura_pct: null,
        litros_consumidos: null,
        km_can: null,
      },
    });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TrazaCargaCard assignmentId="a1" />
      </Wrapper>,
    );
    expand();
    await waitFor(() =>
      expect(screen.getByTestId('traza-carga-body').textContent).toContain('Aún no hay telemetría'),
    );
    expect(screen.getByTestId('traza-carga-resumen').textContent).toContain('Sin dato');
  });

  it('error del endpoint → mensaje de error', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('boom'));
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <TrazaCargaCard assignmentId="a1" />
      </Wrapper>,
    );
    expand();
    await waitFor(() =>
      expect(screen.getByTestId('traza-carga-body').textContent).toContain(
        'No pudimos cargar el recorrido',
      ),
    );
  });
});
