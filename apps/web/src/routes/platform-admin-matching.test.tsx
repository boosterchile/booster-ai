import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

/**
 * Tests del UI de matching backtest (ADR-033 PR #4).
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

describe('PlatformAdminMatchingPage — initial load', () => {
  it('lista corridas al montar', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [SAMPLE_RUN] });
    render(<PlatformAdminMatchingRoute />);

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith('/admin/matching/backtest');
    });
    expect(await screen.findByText(/11111111…/)).toBeInTheDocument();
    expect(screen.getByText(/75%/)).toBeInTheDocument();
  });

  it('error en lista → muestra mensaje', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(
      new ApiError(403, 'forbidden', null, 'forbidden access'),
    );
    render(<PlatformAdminMatchingRoute />);
    expect(await screen.findByText(/403: forbidden access/)).toBeInTheDocument();
  });

  it('lista vacía → muestra empty state', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    render(<PlatformAdminMatchingRoute />);
    expect(await screen.findByText(/Sin corridas todavía/)).toBeInTheDocument();
  });
});

describe('RunForm — disparar corrida', () => {
  it('botón "Ejecutar backtest" hace POST /admin/matching/backtest', async () => {
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
    expect(await screen.findByText(/11111111… completada/)).toBeInTheDocument();
  });

  it('checkbox pesos custom muestra inputs de cada peso', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const checkbox = await screen.findByRole('checkbox', { name: /Pesos custom/i });
    await user.click(checkbox);

    expect(screen.getByText('Capacidad')).toBeInTheDocument();
    expect(screen.getByText('Backhaul')).toBeInTheDocument();
    expect(screen.getByText('Reputación')).toBeInTheDocument();
    expect(screen.getByText('Tier')).toBeInTheDocument();
  });

  it('pesos custom con suma ≠ 1 → error inline antes de hacer POST', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ ok: true, runs: [] });
    const postSpy = vi.spyOn(api, 'post');

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const checkbox = await screen.findByRole('checkbox', { name: /Pesos custom/i });
    await user.click(checkbox);

    // Cambiar capacidad a 0.9 → suma = 1.5
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
    expect(await screen.findByText(/Pesos deben sumar 1\.0/)).toBeInTheDocument();
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

    expect(await screen.findByText(/BOOSTER_PLATFORM_ADMIN_EMAILS/)).toBeInTheDocument();
  });
});

describe('Detalle de corrida', () => {
  it('click en una corrida hace GET /admin/matching/backtest/:id y muestra cards', async () => {
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

    // Esperar que la lista se cargue.
    const runButton = await screen.findByText(/11111111…/);
    await user.click(runButton);

    await waitFor(() => {
      expect(getSpy).toHaveBeenCalledWith(`/admin/matching/backtest/${SAMPLE_RUN.id}`);
    });

    // Cards de métricas.
    expect(await screen.findByText('Overlap top-N')).toBeInTheDocument();
    expect(screen.getByText('75.0%')).toBeInTheDocument();
    expect(screen.getByText('Δ score promedio')).toBeInTheDocument();
    expect(screen.getByText('Backhaul hits')).toBeInTheDocument();

    // Empresas favorecidas / perjudicadas.
    expect(screen.getByText('Empresas favorecidas')).toBeInTheDocument();
    expect(screen.getByText(/\+5/)).toBeInTheDocument();
    expect(screen.getByText('Empresas perjudicadas')).toBeInTheDocument();

    // Distribución de scores.
    expect(screen.getByText(/Distribución de scores v2/)).toBeInTheDocument();

    // Detalle por trip.
    expect(screen.getByText(/Detalle por trip \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/trip-1…/)).toBeInTheDocument();
  });

  it('detalle con errorMessage → muestra el error', async () => {
    vi.spyOn(api, 'get').mockImplementation(((path: string) => {
      if (path === '/admin/matching/backtest') {
        return Promise.resolve({ ok: true, runs: [SAMPLE_RUN] });
      }
      return Promise.reject(new ApiError(500, 'boom', null, 'boom'));
    }) as unknown as typeof api.get);

    const user = userEvent.setup();
    render(<PlatformAdminMatchingRoute />);

    const runButton = await screen.findByText(/11111111…/);
    await user.click(runButton);

    expect(await screen.findByText(/Error en corrida/)).toBeInTheDocument();
    expect(screen.getByText('500: boom')).toBeInTheDocument();
  });
});
