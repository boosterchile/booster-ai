import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ComingSoon } from './coming-soon.js';

afterEach(cleanup);

describe('ComingSoon', () => {
  it('muestra mensaje de próximamente y un canal de contacto, sin form', () => {
    render(<ComingSoon />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /soporte@boosterchile\.com/i }).getAttribute('href'),
    ).toBe('mailto:soporte@boosterchile.com');
    // No hay campos de formulario en el estado "próximamente".
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
