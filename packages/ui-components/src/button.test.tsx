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

  it('primary usa el verde Booster + texto blanco (D-18; blindaje #576: nunca texto negro)', () => {
    render(<Button variant="primary">Ir</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('bg-primary-600');
    expect(cls).toContain('hover:bg-primary-700');
    expect(cls).toContain('active:bg-primary-800');
    expect(cls).toContain('text-white');
  });

  it('ninguna variante usa el acento: el botón no cambia con el color elegido (D-18)', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger'] as const) {
      const { unmount } = render(<Button variant={variant}>Ir</Button>);
      expect(screen.getByRole('button').className).not.toContain('accent');
      unmount();
    }
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

  it('link: se ve como enlace de texto, sin relleno', () => {
    render(<Button variant="link">Ver detalle</Button>);
    const btn = screen.getByRole('button', { name: 'Ver detalle' });
    expect(btn.className).toContain('text-primary-700');
    expect(btn.className).toContain('hover:underline');
    expect(btn.className).not.toMatch(/\bbg-primary-/);
  });

  it('size sm: más compacto, con un mínimo táctil de 2rem', () => {
    render(<Button size="sm">Editar</Button>);
    const btn = screen.getByRole('button', { name: 'Editar' });
    expect(btn.className).toContain('text-xs');
    expect(btn.style.minHeight).toBe('2rem');
    expect(btn.style.paddingInline).toBe('0.75rem');
  });

  it('size icon: cuadrado del tamaño táctil del registro, exige nombre accesible por aria-label', () => {
    render(
      <Button size="icon" variant="ghost" aria-label="Cerrar">
        <svg aria-hidden="true" />
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Cerrar' });
    expect(btn.style.minHeight).toBe('var(--touch-min)');
    expect(btn.style.minWidth).toBe('var(--touch-min)');
    expect(btn.style.padding).toBe('0px');
  });

  it('size inline: dentro de un texto, sin alto mínimo ni relleno', () => {
    render(
      <Button size="inline" variant="link">
        reenviar
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'reenviar' });
    expect(btn.style.minHeight).toBe('');
    expect(btn.style.paddingInline).toBe('');
    expect(btn.className).toContain('inline');
  });

  it('link inline va subrayado siempre: dentro de un texto no se distingue solo por color (WCAG 1.4.1)', () => {
    render(
      <p>
        Sin dispositivo no hay historial.{' '}
        <Button size="inline" variant="link">
          Configurar dispositivo
        </Button>
      </p>,
    );
    const btn = screen.getByRole('button', { name: 'Configurar dispositivo' });
    expect(btn.className).toMatch(/(^|\s)underline(\s|$)/);
  });
});
