import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HomePage from './page.js';

afterEach(cleanup);

describe('HomePage (T7)', () => {
  it('renderiza el Hero (h1) y el CTA a /signup', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/logística sostenible/i);
    expect(screen.getByRole('link', { name: /solicitar acceso/i }).getAttribute('href')).toBe(
      '/signup',
    );
  });

  it('muestra los 3 segmentos con links a /soluciones/*', () => {
    render(<HomePage />);
    expect(screen.getByRole('link', { name: /eres transportista/i }).getAttribute('href')).toBe(
      '/soluciones/transportistas',
    );
    expect(screen.getByRole('link', { name: /eres generador/i }).getAttribute('href')).toBe(
      '/soluciones/generadores',
    );
    expect(screen.getByRole('link', { name: /stakeholder esg/i }).getAttribute('href')).toBe(
      '/soluciones/stakeholders-esg',
    );
  });
});
