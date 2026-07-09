import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AparienciaRoute } from './apariencia.js';

/**
 * Prueba del theming en runtime (D1 · H4): elegir un preset cambia el acento
 * EN VIVO vía `data-accent` en <html>. Verifica el mecanismo end-to-end del
 * selector sin depender del navegador real.
 */

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
});
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
});

describe('AparienciaRoute — selector de acento', () => {
  it('muestra los 7 presets', () => {
    render(<AparienciaRoute />);
    for (const key of [
      'indigo',
      'oceano',
      'terracota',
      'ciruela',
      'pizarra',
      'cobalto',
      'berenjena',
    ]) {
      expect(screen.getByTestId(`accent-option-${key}`)).toBeInTheDocument();
    }
  });

  it('default Índigo marcado (checked) al inicio', () => {
    render(<AparienciaRoute />);
    expect(screen.getByTestId('accent-option-indigo')).toBeChecked();
    expect(screen.getByTestId('accent-option-oceano')).not.toBeChecked();
  });

  it('elegir un preset setea data-accent en <html> EN VIVO + persiste', async () => {
    render(<AparienciaRoute />);
    await userEvent.click(screen.getByTestId('accent-option-terracota'));

    expect(document.documentElement.dataset.accent).toBe('terracota');
    expect(screen.getByTestId('accent-option-terracota')).toBeChecked();
    expect(localStorage.getItem('booster.accent')).toBe('terracota');
  });

  it('cambiar entre presets actualiza data-accent cada vez', async () => {
    render(<AparienciaRoute />);
    await userEvent.click(screen.getByTestId('accent-option-cobalto'));
    expect(document.documentElement.dataset.accent).toBe('cobalto');
    await userEvent.click(screen.getByTestId('accent-option-berenjena'));
    expect(document.documentElement.dataset.accent).toBe('berenjena');
  });
});
