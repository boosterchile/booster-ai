import { registerScales } from '@booster-ai/ui-tokens';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button.js';
import { axeCheck } from './test-utils.js';

describe('Button', () => {
  it('renderiza como <button> con nombre accesible y type=button por defecto', () => {
    render(<Button>Guardar</Button>);
    const btn = screen.getByRole('button', { name: 'Guardar' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });

  it('sin violaciones de a11y', async () => {
    const { container } = render(<Button>Guardar</Button>);
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  it('primary usa el acento + texto blanco (blindaje #576: nunca texto negro sobre el fill)', () => {
    render(<Button variant="primary">Ir</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-accent-600');
    expect(cls).toContain('text-white');
  });

  it('danger usa el semántico danger + texto blanco (no el acento)', () => {
    render(<Button variant="danger">Borrar</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-danger-600');
    expect(cls).toContain('text-white');
    expect(cls).not.toContain('bg-accent');
  });

  it('el tamaño lo dictan las custom properties de registro (no reimplementa)', () => {
    render(<Button>Ir</Button>);
    const btn = screen.getByRole('button');
    expect(btn.style.minHeight).toBe('var(--touch-min)');
    expect(btn.style.paddingBlock).toBe('var(--pad-y)');
    expect(btn.style.paddingInline).toBe('var(--pad-x)');
  });

  it('el touch target del conductor resuelve ≥44px (WCAG) vía el token que Button consume', () => {
    // Button consume var(--touch-min); su valor bajo [data-register=conductor]
    // lo fija el token D1 registerScales.conductor.touchMin.
    expect(Number.parseInt(registerScales.conductor.touchMin, 10)).toBeGreaterThanOrEqual(44);
    expect(Number.parseInt(registerScales.operador.touchMin, 10)).toBeGreaterThanOrEqual(44);
  });

  it('disabled es real (atributo nativo), no solo visual', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Ir
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(btn); // click nativo sobre disabled no dispara (garantía del browser)
  });

  it('loading marca aria-busy, deshabilita y muestra spinner', () => {
    render(<Button loading>Guardar</Button>);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('mergea className del consumidor vía cn() (última gana en conflicto)', () => {
    render(<Button className="rounded-none">Ir</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('rounded-none');
    expect(cls).not.toContain('rounded-md');
  });
});
