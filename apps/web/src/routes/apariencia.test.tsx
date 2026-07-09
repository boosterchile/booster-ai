import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AparienciaRoute } from './apariencia.js';

/**
 * Theming en runtime con DOS paletas por rol (D-4/D-5): operador (sobria) y
 * conductor (LED). Elegir un preset cambia el acento EN VIVO vía `data-accent`.
 */

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
});
afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.accent;
});

describe('AparienciaRoute — paleta operador (default)', () => {
  it('muestra los 6 presets sobrios, Índigo marcado', () => {
    render(<AparienciaRoute />);
    for (const key of ['indigo', 'oceano', 'ciruela', 'pizarra', 'cobalto', 'berenjena']) {
      expect(screen.getByTestId(`accent-option-${key}`)).toBeInTheDocument();
    }
    // no muestra presets LED del conductor
    expect(screen.queryByTestId('accent-option-azul-led')).not.toBeInTheDocument();
    expect(screen.getByTestId('accent-option-indigo')).toBeChecked();
  });

  it('elegir un preset setea data-accent en <html> EN VIVO + persiste por paleta', async () => {
    render(<AparienciaRoute />);
    await userEvent.click(screen.getByTestId('accent-option-cobalto'));
    expect(document.documentElement.dataset.accent).toBe('cobalto');
    expect(localStorage.getItem('booster.accent.operator')).toBe('cobalto');
  });
});

describe('AparienciaRoute — toggle a paleta conductor (LED)', () => {
  it('togglear a Conductor muestra los 7 LED, Azul LED marcado (default)', async () => {
    render(<AparienciaRoute />);
    await userEvent.click(screen.getByTestId('palette-toggle-conductor'));
    for (const key of [
      'ambar-led',
      'naranjo-led',
      'rojo-led',
      'azul-led',
      'verde-led',
      'fluor',
      'negro',
    ]) {
      expect(screen.getByTestId(`accent-option-${key}`)).toBeInTheDocument();
    }
    // ya no muestra los sobrios
    expect(screen.queryByTestId('accent-option-indigo')).not.toBeInTheDocument();
    expect(screen.getByTestId('accent-option-azul-led')).toBeChecked();
    // el toggle aplicó el default del conductor al DOM
    expect(document.documentElement.dataset.accent).toBe('azul-led');
  });

  it('elegir un LED (Rojo LED) cambia el acento sin pisar los semánticos (fijos)', async () => {
    render(<AparienciaRoute />);
    await userEvent.click(screen.getByTestId('palette-toggle-conductor'));
    await userEvent.click(screen.getByTestId('accent-option-rojo-led'));
    expect(document.documentElement.dataset.accent).toBe('rojo-led');
    expect(localStorage.getItem('booster.accent.conductor')).toBe('rojo-led');
    // el acento es rojo-led, pero el token de error (danger) es independiente:
    // el data-accent no toca --color-danger-*, así que "elegir Rojo LED" NO
    // pisa el rojo-error (verificado a nivel token en ui-tokens/contrast.test).
  });
});
