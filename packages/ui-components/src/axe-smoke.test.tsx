import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axeCheck } from './test-utils.js';

// Humo del cableado de vitest-axe (Vuelta 0): confirma que axe-core corre de
// verdad sobre el DOM de jsdom y que el matcher está registrado.
describe('vitest-axe — cableado', () => {
  it('un botón etiquetado no tiene violaciones de a11y', async () => {
    const { container } = render(<button type="button">Guardar</button>);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
