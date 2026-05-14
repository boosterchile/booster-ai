import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { ForecastTab } from './ForecastTab.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('ForecastTab', () => {
  it('renderiza forecast + budget + variance bajo budget', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      forecastClpEndOfMonth: 800_000,
      budgetClp: 925_000,
      variancePercent: -13.5,
      dayOfMonth: 15,
      daysInMonth: 30,
      daysRemaining: 15,
      currentRate: {
        clpPerUsd: 925,
        observedAt: '2026-05-13T00:00:00Z',
        source: 'mindicador',
      },
    });
    render(<ForecastTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/\$800\.000 CLP/)).toBeInTheDocument());
    expect(screen.getByText(/13\.5% bajo budget/)).toBeInTheDocument();
    expect(screen.getByText('mindicador')).toBeInTheDocument();
  });

  it('sobre budget muestra ↑ y porcentaje', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      forecastClpEndOfMonth: 1_200_000,
      budgetClp: 925_000,
      variancePercent: 29.7,
      dayOfMonth: 15,
      daysInMonth: 30,
      daysRemaining: 15,
      currentRate: {
        clpPerUsd: 925,
        observedAt: '2026-05-13T00:00:00Z',
        source: 'mindicador',
      },
    });
    render(<ForecastTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/29\.7% sobre budget/)).toBeInTheDocument());
  });

  it('FX source ≠ mindicador → muestra advertencia stale', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      forecastClpEndOfMonth: 500_000,
      budgetClp: 925_000,
      variancePercent: -45.9,
      dayOfMonth: 10,
      daysInMonth: 30,
      daysRemaining: 20,
      currentRate: {
        clpPerUsd: 940,
        observedAt: '2026-05-13T00:00:00Z',
        source: 'hardcoded',
      },
    });
    render(<ForecastTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/FX no es del día actual/)).toBeInTheDocument());
  });
});
