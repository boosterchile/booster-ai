import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

vi.mock('./Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main data-title={title}>{children}</main>
  ),
}));

const { ServicioNoActivo } = await import('./ServicioNoActivo.js');

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

describe('ServicioNoActivo', () => {
  it('dice que el servicio no está activo, qué sigue disponible y vuelve al inicio', () => {
    render(<ServicioNoActivo me={{} as MeOnboarded} titulo="Ofertas activas" />);
    expect(screen.getByRole('main')).toHaveAttribute('data-title', 'Ofertas activas');
    expect(
      screen.getByText('Tu empresa no tiene activo el servicio de ofertas de carga'),
    ).toBeInTheDocument();
    expect(screen.getByText(/tus viajes propios siguen disponibles/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/app');
  });
});
