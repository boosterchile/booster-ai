import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FormField, inputClass } from './FormField.js';

describe('FormField', () => {
  it('renderiza label y wrapping del render-prop', () => {
    render(
      <FormField label="Nombre" render={({ id }) => <input id={id} defaultValue="Felipe" />} />,
    );
    const input = screen.getByLabelText('Nombre');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Felipe');
  });

  it('marca campos requeridos con asterisco accesible', () => {
    render(<FormField label="Email" required render={({ id }) => <input id={id} />} />);
    expect(screen.getByLabelText('requerido')).toBeInTheDocument();
  });

  it('muestra hint cuando no hay error', () => {
    render(
      <FormField
        label="Teléfono"
        hint="Formato +56 9 XXXX XXXX"
        render={({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
      />,
    );
    expect(screen.getByText('Formato +56 9 XXXX XXXX')).toBeInTheDocument();
    // El input debería describir el hint
    const input = screen.getByLabelText('Teléfono');
    const hint = screen.getByText('Formato +56 9 XXXX XXXX');
    expect(input).toHaveAttribute('aria-describedby', hint.id);
  });

  it('reemplaza hint por error cuando hay error', () => {
    render(
      <FormField
        label="Teléfono"
        hint="Formato +56 9 XXXX XXXX"
        error="Número inválido"
        render={({ id, describedBy }) => <input id={id} aria-describedby={describedBy} />}
      />,
    );
    expect(screen.queryByText('Formato +56 9 XXXX XXXX')).not.toBeInTheDocument();
    const errorEl = screen.getByText('Número inválido');
    expect(errorEl).toHaveAttribute('role', 'alert');
    // describedBy ahora apunta al error, no al hint
    const input = screen.getByLabelText('Teléfono');
    expect(input).toHaveAttribute('aria-describedby', errorEl.id);
  });

  it('omite describedBy cuando no hay hint ni error', () => {
    render(
      <FormField
        label="Nombre"
        render={({ id, describedBy }) => {
          expect(describedBy).toBeUndefined();
          return <input id={id} />;
        }}
      />,
    );
  });

  it('genera ids únicos para cada FormField', () => {
    render(
      <>
        <FormField label="A" render={({ id }) => <input id={id} />} />
        <FormField label="B" render={({ id }) => <input id={id} />} />
      </>,
    );
    const a = screen.getByLabelText('A');
    const b = screen.getByLabelText('B');
    expect(a.id).not.toBe(b.id);
  });
});

describe('inputClass', () => {
  it('agrega clase de error cuando hasError=true', () => {
    expect(inputClass(true)).toContain('border-danger-500');
    expect(inputClass(true)).not.toContain('border-neutral-300');
  });

  it('usa clase neutral cuando hasError=false', () => {
    expect(inputClass(false)).toContain('border-neutral-300');
    expect(inputClass(false)).not.toContain('border-danger-500');
  });

  it('mantiene clases base independiente del flag', () => {
    expect(inputClass(false)).toContain('w-full');
    expect(inputClass(true)).toContain('w-full');
  });
});
