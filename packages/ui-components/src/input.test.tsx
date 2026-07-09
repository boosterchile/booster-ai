import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from './input.js';
import { axeCheck } from './test-utils.js';

describe('Input', () => {
  it('renderiza un <input> accesible (labeling por el consumidor)', () => {
    render(<Input aria-label="RUT" />);
    expect(screen.getByRole('textbox', { name: 'RUT' }).tagName).toBe('INPUT');
  });

  it('sin violaciones de a11y cuando tiene label', async () => {
    const { container } = render(<Input aria-label="Correo" type="email" />);
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  it('en estado inválido expone aria-invalid y el borde de error', () => {
    render(<Input aria-label="RUT" invalid aria-describedby="rut-error" />);
    const input = screen.getByRole('textbox', { name: 'RUT' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('rut-error');
    expect(input.className).toContain('border-danger-500');
  });

  it('sin error no marca aria-invalid y usa el borde neutro', () => {
    render(<Input aria-label="RUT" />);
    const input = screen.getByRole('textbox', { name: 'RUT' });
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.className).toContain('border-neutral-300');
  });

  it('el tamaño responde al registro vía custom properties (no reimplementa)', () => {
    render(<Input aria-label="RUT" />);
    const input = screen.getByRole('textbox', { name: 'RUT' });
    expect(input.style.minHeight).toBe('var(--touch-min)');
    expect(input.style.paddingBlock).toBe('var(--pad-y)');
  });

  it('reenvía disabled nativo', () => {
    render(<Input aria-label="RUT" disabled />);
    expect(screen.getByRole('textbox', { name: 'RUT' })).toHaveProperty('disabled', true);
  });
});
