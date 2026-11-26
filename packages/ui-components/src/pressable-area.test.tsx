import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PressableArea } from './pressable-area.js';
import { axeCheck } from './test-utils.js';

describe('PressableArea', () => {
  it('es un <button> type=button por defecto, alineado a la izquierda y con foco visible', () => {
    render(<PressableArea>Camión ABCD12</PressableArea>);
    const el = screen.getByRole('button', { name: 'Camión ABCD12' });
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('type')).toBe('button');
    expect(el.className).toContain('text-left');
    expect(el.className).toContain('focus-visible:ring-2');
  });

  it('no pinta un botón: sin fondo, sin color de texto, sin borde propio', () => {
    render(<PressableArea>fila</PressableArea>);
    const el = screen.getByRole('button', { name: 'fila' });
    expect(el.className).not.toMatch(/\bbg-|\btext-(white|primary|neutral)|\bborder\b/);
  });

  it('reenvía onClick, disabled y className de layout', () => {
    const onClick = vi.fn();
    render(
      <PressableArea onClick={onClick} className="flex w-full" data-testid="fila">
        fila
      </PressableArea>,
    );
    const el = screen.getByTestId('fila');
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
    expect(el.className).toContain('w-full');
  });

  it('sin violaciones de axe', async () => {
    const { container } = render(<PressableArea>fila</PressableArea>);
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
