import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FootprintSeal } from './footprint-seal.js';
import { axeCheck } from './test-utils.js';

describe('FootprintSeal (decisión 2 del PO, 2026-11-25)', () => {
  it('«Medido» solo cuando la huella misma fue medida (primario)', () => {
    render(<FootprintSeal presentacion="primario" />);
    expect(screen.getByText('Medido')).toBeDefined();
  });

  it('la presentación intermedia conserva su texto y no lleva «Medido»', () => {
    const { container } = render(<FootprintSeal presentacion="medido_teltonika" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.textContent).toBe('Distancia medida con Teltonika · consumo modelado');
    expect(el.textContent).not.toMatch(/^Medido$/);
    expect(screen.queryByText('Medido')).toBeNull();
    expect(screen.queryByText('Estimado')).toBeNull();
  });

  it('lo demás es «Estimado»', () => {
    render(<FootprintSeal presentacion="estimado" />);
    expect(screen.getByText('Estimado')).toBeDefined();
  });

  it('son tres presentaciones con forma distinta', () => {
    const formas = (['primario', 'medido_teltonika', 'estimado'] as const).map((p) => {
      const { container, unmount } = render(<FootprintSeal presentacion={p} />);
      const el = container.firstElementChild as HTMLElement;
      const forma = `${el.dataset.presentacion}|${el.className}|${el.querySelector('svg')?.innerHTML}`;
      unmount();
      return forma;
    });
    expect(new Set(formas).size).toBe(3);
  });

  it('sin violaciones de axe en las tres presentaciones', async () => {
    for (const p of ['primario', 'medido_teltonika', 'estimado'] as const) {
      const { container, unmount } = render(<FootprintSeal presentacion={p} />);
      expect(await axeCheck(container)).toHaveNoViolations();
      unmount();
    }
  });
});
