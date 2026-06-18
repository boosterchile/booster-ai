import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageShell } from './PageShell.js';

afterEach(cleanup);

describe('PageShell', () => {
  it('renderiza título (h1) e intro', () => {
    render(<PageShell title="Soluciones" intro="Elige tu rol." />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Soluciones');
    expect(screen.getByText('Elige tu rol.')).toBeTruthy();
  });

  it('renderiza children cuando se pasan', () => {
    render(
      <PageShell title="T" intro="I">
        <p>contenido extra</p>
      </PageShell>,
    );
    expect(screen.getByText('contenido extra')).toBeTruthy();
  });
});
