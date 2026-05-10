import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

const { LegalCobraHoyRoute } = await import('./legal-cobra-hoy.js');

describe('LegalCobraHoyRoute', () => {
  it('renderiza header con versión y vínculo a T&Cs marco', () => {
    render(<LegalCobraHoyRoute />);
    expect(screen.getByText(/Adendum — Booster Cobra Hoy/i)).toBeInTheDocument();
    expect(screen.getByText(/Versión 1 · Vigente desde 2026-05-10/)).toBeInTheDocument();
    // "Términos de Servicio v2" aparece tanto en el header (link al marco)
    // como en el body §2, por eso usamos getAllByText.
    expect(screen.getAllByText(/Términos de Servicio v2/).length).toBeGreaterThan(0);
  });

  it('incluye tabla de tarifas con los 4 plazos oficiales', () => {
    render(<LegalCobraHoyRoute />);
    expect(screen.getByText('30 días')).toBeInTheDocument();
    expect(screen.getByText('45 días')).toBeInTheDocument();
    expect(screen.getByText('60 días')).toBeInTheDocument();
    expect(screen.getByText('90 días')).toBeInTheDocument();
    expect(screen.getByText('1,50%')).toBeInTheDocument();
    expect(screen.getByText('4,50%')).toBeInTheDocument();
  });

  it('explica naturaleza partner-mode y no-CMF', () => {
    const { container } = render(<LegalCobraHoyRoute />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/partner-mode/i);
    expect(text).toMatch(/ni requiere registro CMF/i);
  });

  it('declara IVA exento Art. 12-E DL 825', () => {
    const { container } = render(<LegalCobraHoyRoute />);
    expect(container.textContent ?? '').toMatch(/Art\. 12-E DL 825/i);
  });
});
