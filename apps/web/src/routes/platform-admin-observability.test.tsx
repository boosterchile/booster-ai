import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del skeleton route /app/platform-admin/observability.
 *
 * Patrón de mocks (consistente con platform-admin-matching.test.tsx):
 *   - `ProtectedRoute` bypass.
 *   - `Link` de tanstack-router → `<a>`.
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

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminObservabilityRoute', () => {
  it('renderiza los 5 tabs', () => {
    render(<PlatformAdminObservabilityRoute />);
    expect(screen.getByTestId('observability-tab-costos')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-salud')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-uso')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-capacity')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-forecast')).toBeInTheDocument();
  });

  it('costos es el tab inicial activo', () => {
    render(<PlatformAdminObservabilityRoute />);
    expect(screen.getByTestId('observability-panel-costos')).toBeInTheDocument();
    expect(screen.getByTestId('observability-tab-costos')).toHaveAttribute('aria-selected', 'true');
  });

  it('click cambia el tab activo y renderiza el panel correspondiente', () => {
    render(<PlatformAdminObservabilityRoute />);
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
    render(<PlatformAdminObservabilityRoute />);
    expect(screen.getByText(/Volver a Platform Admin/)).toBeInTheDocument();
  });
});
