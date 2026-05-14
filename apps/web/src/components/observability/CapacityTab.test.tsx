import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { CapacityTab } from './CapacityTab.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('CapacityTab', () => {
  it('renderiza utilizations Cloud Run + Cloud SQL', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/observability/usage/cloud-run') {
        return {
          latencyP95Ms: 150,
          cpuUtilization: 0.45,
          ramUtilization: 0.6,
          rps: 12.5,
        };
      }
      if (path === '/admin/observability/usage/cloud-sql') {
        return {
          cpuUtilization: 0.3,
          ramUtilization: 0.5,
          diskUtilization: 0.4,
          connectionsUsedRatio: 0.2,
        };
      }
      return {};
    });

    render(<CapacityTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText('45%')).toBeInTheDocument()); // CPU Cloud Run
    expect(screen.getByText('60%')).toBeInTheDocument(); // RAM Cloud Run
    expect(screen.getByText('150 ms')).toBeInTheDocument();
    expect(screen.getByText('12.5 rps')).toBeInTheDocument();
  });

  it('valores null → Sin datos', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      latencyP95Ms: null,
      cpuUtilization: null,
      ramUtilization: null,
      rps: null,
      diskUtilization: null,
      connectionsUsedRatio: null,
    });
    render(<CapacityTab />, { wrapper: wrapper() });
    await waitFor(() => {
      expect(screen.getAllByText('Sin datos').length).toBeGreaterThan(0);
    });
  });
});
