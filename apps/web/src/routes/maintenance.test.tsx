import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

const { MaintenanceRoute } = await import('./maintenance.js');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('MaintenanceRoute', () => {
  it('renderiza copy explícita SC-INT-1: "Modo demo en mantenimiento"', () => {
    render(<MaintenanceRoute />, { wrapper });
    expect(screen.getByText(/Modo demo en mantenimiento/i)).toBeInTheDocument();
    expect(screen.getByText(/Volvemos pronto/i)).toBeInTheDocument();
  });

  it('expone CTA a producción app.boosterchile.com', () => {
    render(<MaintenanceRoute />, { wrapper });
    const cta = screen.getByRole('link', { name: /app\.boosterchile\.com/i });
    expect(cta).toHaveAttribute('href', 'https://app.boosterchile.com');
  });

  it('NO renderiza el alert genérico "Hubo un problema entrando a la demo"', () => {
    render(<MaintenanceRoute />, { wrapper });
    expect(screen.queryByText(/Hubo un problema entrando a la demo/i)).not.toBeInTheDocument();
  });
});
