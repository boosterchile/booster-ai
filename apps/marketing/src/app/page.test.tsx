import { render, screen } from '@testing-library/react';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import HomePage from './page.js';

afterEach(() => {
  cleanup();
});

describe('HomePage (stub T1)', () => {
  it('renderiza el título y un CTA a /signup', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Booster AI');
    const cta = screen.getByRole('link', { name: /solicitar acceso/i });
    expect(cta.getAttribute('href')).toBe('/signup');
  });
});
