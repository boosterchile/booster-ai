import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignupForm } from './signup-form.js';

afterEach(cleanup);

describe('SignupForm (render + validación cliente, T4)', () => {
  it('renderiza email + nombre con labels y botón, sin selector de rol/empresa', () => {
    render(<SignupForm />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Nombre completo')).toBeTruthy();
    expect(screen.getByRole('button', { name: /solicitar acceso/i })).toBeTruthy();
    expect(screen.queryByLabelText(/rut/i)).toBeNull();
    expect(screen.queryByText(/transportista|generador|empresa/i)).toBeNull();
  });

  it('submit con campos vacíos muestra errores y NO invoca onSubmit', async () => {
    const onSubmit = vi.fn();
    render(<SignupForm onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('button', { name: /solicitar acceso/i }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submit válido invoca onSubmit con {email, nombreCompleto}', async () => {
    const onSubmit = vi.fn();
    render(<SignupForm onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText('Email'), 'ana@empresa.cl');
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Díaz');
    await userEvent.click(screen.getByRole('button', { name: /solicitar acceso/i }));
    expect(onSubmit).toHaveBeenCalledWith({ email: 'ana@empresa.cl', nombreCompleto: 'Ana Díaz' });
  });
});
