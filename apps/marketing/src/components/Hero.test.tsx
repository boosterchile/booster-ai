import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Hero } from './Hero.js';

afterEach(cleanup);

describe('Hero', () => {
  it('renderiza el titular y los CTAs a /signup y /precios', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/logística sostenible/i);
    expect(screen.getByRole('link', { name: /solicitar acceso/i }).getAttribute('href')).toBe(
      '/signup',
    );
    expect(screen.getByRole('link', { name: /ver precios/i }).getAttribute('href')).toBe(
      '/precios',
    );
  });
});
