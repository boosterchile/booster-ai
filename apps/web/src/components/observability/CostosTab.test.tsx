import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { CostosTab } from './CostosTab.js';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CostosTab', () => {
  it('renderiza overview + breakdowns cuando endpoints OK', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/observability/costs/overview') {
        return {
          costClpMonthToDate: 100_000,
          costClpPreviousMonth: 200_000,
          costClpPreviousMonthSamePeriod: 90_000,
          deltaPercentVsPreviousMonth: 11.1,
          lastBillingExportAt: '2026-05-13T13:00:00Z',
        };
      }
      if (path.startsWith('/admin/observability/costs/by-service')) {
        return { days: 30, items: [{ service: 'Cloud Run', costClp: 60_000, percentOfTotal: 60 }] };
      }
      if (path.startsWith('/admin/observability/costs/by-project')) {
        return { days: 30, items: [] };
      }
      if (path.startsWith('/admin/observability/costs/trend')) {
        return { days: 30, points: [{ date: '2026-05-13', costClp: 5000 }] };
      }
      if (path.startsWith('/admin/observability/costs/top-skus')) {
        return { limit: 10, items: [{ service: 'Cloud Run', sku: 'CPU', costClp: 30_000 }] };
      }
      if (path.startsWith('/admin/observability/costs/monthly-history')) {
        return {
          months: 12,
          items: [
            { month: '2026-04', costClp: 250_000, deltaPercentVsPrior: null, isCurrent: false },
            { month: '2026-05', costClp: 248_350, deltaPercentVsPrior: -0.7, isCurrent: true },
          ],
        };
      }
      return {};
    });

    render(<CostosTab />, {
      wrapper: wrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });

    // El KPI MTD se renderiza
    await waitFor(() => {
      expect(screen.getByText(/\$100\.000 CLP/)).toBeInTheDocument();
    });
    // Top SKUs table
    expect(screen.getByText('Top 10 SKUs del mes')).toBeInTheDocument();
  });

  it('muestra placeholder de error si el provider falla', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('502 BQ unavailable'));
    render(<CostosTab />, {
      wrapper: wrapper(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
    });
    await waitFor(() => {
      expect(screen.getAllByText(/No se pudo cargar|Sin datos/).length).toBeGreaterThan(0);
    });
  });
});
