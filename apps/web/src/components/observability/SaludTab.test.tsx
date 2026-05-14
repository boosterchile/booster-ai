import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { SaludTab } from './SaludTab.js';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('SaludTab', () => {
  it('renderiza overall + componentes cuando snapshot OK', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      overall: 'healthy',
      components: [
        { name: 'uptime', level: 'healthy', message: '99.9%' },
        { name: 'cloud-run', level: 'degraded', message: 'CPU 78%' },
      ],
      lastEvaluatedAt: '2026-05-13T20:00:00Z',
    });
    render(<SaludTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText('🟢 Healthy')).toBeInTheDocument());
    expect(screen.getByText('uptime')).toBeInTheDocument();
    expect(screen.getByText('cloud-run')).toBeInTheDocument();
  });

  it('muestra estado crítico cuando overall=critical', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      overall: 'critical',
      components: [{ name: 'uptime', level: 'critical', message: '95%' }],
      lastEvaluatedAt: '2026-05-13T20:00:00Z',
    });
    render(<SaludTab />, { wrapper: wrapper() });
    await waitFor(() => expect(screen.getByText(/🔴 Critical/)).toBeInTheDocument());
  });
});
