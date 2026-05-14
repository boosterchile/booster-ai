import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

/**
 * Tests del route /app/platform-admin/observability con los 5 tabs reales.
 *
 * Patrón de mocks (consistente con platform-admin-matching.test.tsx):
 *   - `ProtectedRoute` bypass.
 *   - `Link` de tanstack-router → `<a>`.
 *   - `api.get` mockeado para que los hooks TanStack Query no fallen al
 *     hidratar (los tabs montan al cambiar activeTab).
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

const { PlatformAdminObservabilityRoute } = await import('./platform-admin-observability.js');

function renderWithProviders(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlatformAdminObservabilityRoute />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Stub api.get para que los hooks no exploten cuando se monten los tabs.
  vi.spyOn(api, 'get').mockResolvedValue({});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminObservabilityRoute', () => {
  it('renderiza los 5 tabs', () => {
    renderWithProviders();
    expect(screen.getByTestId('observability-tab-costos')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-salud')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-uso')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-forecast')).toBeInTheDocument();
  });

  it('costos es el tab inicial activo', () => {
    renderWithProviders();
    expect(screen.getByTestId('observability-panel-costos')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-costos')).toHaveAttribute('aria-selected', 'true');
  });

  it('click cambia el tab activo y renderiza el panel correspondiente', () => {
    renderWithProviders();
    fireEvent.click(screen.getByTestId('observability-tab-forecast'));
    expect(screen.getByTestId('observability-panel-forecast')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-forecast')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('observability-tab-costos')).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('header tiene link de regreso a /app/platform-admin', () => {
    renderWithProviders();
    expect(screen.getByText(/Volver a Platform Admin/)).toBeInTheDocument();
  });
});
