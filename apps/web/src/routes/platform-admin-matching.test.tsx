import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Tests del UI de "Comparar algoritmo de asignación" (ADR-033).
 *
 * Verifican que los strings y mensajes de error estén en español natural
 * sin jerga técnica (backtest, overlap, score deltas, ADR-033, etc.) —
 * el operador no debería ver términos internos al leer la página.
 *
 * Patrones de mock:
 *   - `ProtectedRoute` bypass: la página se renderiza sin requerir auth.
 *   - `@tanstack/react-router` Link → <a>.
 *   - `api.get`/`api.post` vía spies.
 */

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: () => ReactNode }) => <>{children()}</>,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: vi.fn(async () => undefined),
}));

const { PlatformAdminMatchingRoute } = await import('./platform-admin-matching.js');

const SAMPLE_RUN = {
  id: '11111111-1111-1111-1111-111111111111',
  createdAt: '2026-05-12T12:00:00Z',
  createdByEmail: 'admin@boosterchile.com',
  estado: 'completada' as const,
  tripsProcesados: 100,
  resumenPreview: { topNOverlapPct: 75, scoreDeltaAvg: 0.05 },
};

const SAMPLE_DETAIL = {
  id: '11111111-1111-1111-1111-111111111111',
  createdAt: '2026-05-12T12:00:00Z',
  completedAt: '2026-05-12T12:00:30Z',
  createdByEmail: 'admin@boosterchile.com',
  estado: 'completada',
  tripsProcesados: 100,
  tripsConCandidatosV1: 95,
  tripsConCandidatosV2: 95,
  pesosUsados: { capacidad: 0.4, backhaul: 0.35, reputacion: 0.15, tier: 0.1 },
  metricasResumen: {
    tripsProcesados: 100,
    tripsConCandidatosV1: 95,
    tripsConCandidatosV2: 95,
    topNOverlapPct: 75,
    scoreDeltaAvg: 0.05,
    backhaulHitRatePct: 30,
    empresasFavorecidas: [{ empresaId: 'emp-A', delta: 5 }],
    empresasPerjudicadas: [{ empresaId: 'emp-B', delta: -3 }],
    distribucionScoresV2: {
      '0-200': 10,
      '200-400': 15,
      '400-600': 30,
      '600-800': 25,
      '800-1000': 20,
    },
  },
  resultados: [
    {
      tripId: 'trip-1',
      originRegionCode: 'RM',
      cargoWeightKg: 5000,
      candidatosTotal: 3,
      ofertasV1: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 900 }],
      ofertasV2: [{ empresaId: 'emp-A', vehicleId: 'v1', scoreInt: 950 }],
      overlapEmpresas: 1,
      deltaScorePromedio: 0.05,
      backhaulHit: true,
    },
  ],
  errorMessage: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminMatchingPage — carga inicial', () => {
  it('lista simulaciones al montar', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [SAMPLE_RUN] });
    render(<PlatformAdminMatchingRoute />);

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/admin/matching/backtest');
    });
    // La fila muestra el conteo de viajes analizados + autor + métricas humanizadas.
    expect(await screen.findByText(/100 viajes analizados/)).toBeInTheDocument();
    expect(screen.getByText(/admin@boosterchile.com/)).toBeInTheDocument();
    // El "75%" va dentro de un <strong> separado del resto del texto — busco partes.
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/coincide con el algoritmo actual/)).toBeInTheDocument();
  });

  it('error 403 → humaniza el mensaje (sin allowlist)', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      new ApiError(403, 'forbidden_platform_admin', null, '403 forbidden_platform_admin'),
    );
    render(<PlatformAdminMatchingRoute />);
    expect(
      await screen.findByText(/Tu email no tiene permiso para acceder a esta sección/),
    ).toBeInTheDocument();
  });

  it('lista vacía → muestra estado vacío en español', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    render(<PlatformAdminMatchingRoute />);
    expect(await screen.findByText(/Todavía no se hizo ninguna simulación/)).toBeInTheDocument();
  });
});

describe('Formulario — lanzar simulación', () => {
  it('botón "Lanzar simulación" hace POST /admin/matching/backtest', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      id: SAMPLE_RUN.id,
      resumen: SAMPLE_DETAIL.metricasResumen,
    });

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const button = await screen.findByTestId('run-backtest-button');
    await user.click(button);

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        '/admin/matching/backtest',
        expect.objectContaining({ tripsLimit: 500 }),
      );
    });
    // Mensaje de éxito en español natural.
    expect(await screen.findByText(/Simulación completada/)).toBeInTheDocument();
    expect(screen.getByText(/100 viajes analizados · 75% de coincidencia/)).toBeInTheDocument();
  });

  it('checkbox de ajustar manualmente muestra inputs de cada peso con descripciones', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const checkbox = await screen.findByRole('checkbox', { name: /Ajustar manualmente/i });
    await user.click(checkbox);

    // Labels descriptivos en lugar de jerga.
    expect(screen.getByText('Capacidad ajustada')).toBeInTheDocument();
    expect(screen.getByText('Viaje de retorno')).toBeInTheDocument();
    expect(screen.getByText('Reputación')).toBeInTheDocument();
    expect(screen.getByText('Tier de membresía')).toBeInTheDocument();
    // Hints explicativos
    expect(screen.getByText(/vehículo no sobredimensionado para la carga/)).toBeInTheDocument();
  });

  it('pesos con suma ≠ 1 → mensaje claro en español, no se hace POST', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    const postSpy = vi.spyOn(api, 'post');

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const checkbox = await screen.findByRole('checkbox', { name: /Ajustar manualmente/i });
    await user.click(checkbox);

    const capacidadInputs = screen.getAllByDisplayValue('0.4');
    const capacidadNumeric = capacidadInputs.find(
      (el) => el instanceof HTMLInputElement && el.type === 'number',
    );
    if (capacidadNumeric) {
      await user.clear(capacidadNumeric);
      await user.type(capacidadNumeric, '0.9');
    }

    const button = screen.getByTestId('run-backtest-button');
    await user.click(button);

    expect(postSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/La suma de los pesos tiene que ser 1\.00/)).toBeInTheDocument();
  });

  it('servicio falla con 403 → muestra ayuda sobre allowlist', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(403, 'forbidden_platform_admin', null, '403 forbidden_platform_admin'),
    );

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const button = await screen.findByTestId('run-backtest-button');
    await user.click(button);

    // Mensaje humanizado, sin jerga técnica ni referencias a env vars.
    expect(
      await screen.findByText(/Tu email no tiene permiso para acceder a esta sección/),
    ).toBeInTheDocument();
  });
});

describe('Detalle de una simulación', () => {
  it('click en una simulación carga el detalle con métricas en español', async () => {
    const getSpy = vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/admin/matching/backtest') {
        return Promise.resolve({ ok: true, runs: [SAMPLE_RUN] });
      }
      if (path === `/admin/matching/backtest/${SAMPLE_RUN.id}`) {
        return Promise.resolve({ ok: true, run: SAMPLE_DETAIL });
      }
      return Promise.reject(new Error('unexpected path'));
    }) as unknown as typeof api.get);

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    // La fila se identifica por el conteo de viajes analizados.
    const runRow = await screen.findByText(/100 viajes analizados/);
    await user.click(runRow);

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(`/admin/matching/backtest/${SAMPLE_RUN.id}`);
    });

    // Cards con labels descriptivos.
    expect(await screen.findByText('Viajes analizados')).toBeInTheDocument();
    expect(screen.getByText('Coincidencia con algoritmo actual')).toBeInTheDocument();
    expect(screen.getByText('Cambio promedio de puntaje')).toBeInTheDocument();
    expect(screen.getByText('Viajes con retorno aprovechado')).toBeInTheDocument();

    // Panel de movers en lenguaje claro.
    expect(screen.getByText('Transportistas que reciben más ofertas')).toBeInTheDocument();
    expect(screen.getByText(/\+5 ofertas/)).toBeInTheDocument();
    expect(screen.getByText('Transportistas que reciben menos ofertas')).toBeInTheDocument();

    // Distribución renombrada en términos de calidad.
    expect(
      screen.getByText(/Qué tan buenos son los matches que produce el algoritmo nuevo/),
    ).toBeInTheDocument();
    expect(screen.getByText('Excelente')).toBeInTheDocument();

    // Tabla de detalle viaje por viaje (no "Detalle por trip").
    expect(screen.getByText(/Detalle viaje por viaje/)).toBeInTheDocument();
    expect(screen.getByText(/trip-1…/)).toBeInTheDocument();
  });

  it('detalle con errorMessage → mensaje humanizado, sin código técnico', async () => {
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/admin/matching/backtest') {
        return Promise.resolve({ ok: true, runs: [SAMPLE_RUN] });
      }
      return Promise.reject(new ApiError(500, 'boom', null, 'boom'));
    }) as unknown as typeof api.get);

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const runRow = await screen.findByText(/100 viajes analizados/);
    await user.click(runRow);

    expect(await screen.findByText(/No pudimos cargar esta simulación/)).toBeInTheDocument();
    expect(screen.getByText(/La simulación falló del lado del servidor/)).toBeInTheDocument();
  });
});
