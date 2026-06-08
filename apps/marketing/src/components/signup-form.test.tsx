import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SignupOutcome } from '../lib/signup-client.js';
import { SignupForm } from './signup-form.js';

afterEach(cleanup);

const stub = (outcome: SignupOutcome) => vi.fn(async () => outcome);

describe('SignupForm (render + validación cliente, T4)', () => {
  it('renderiza email + nombre con labels y botón, sin selector de rol/empresa', () => {
    render(<SignupForm submitRequest={stub('submitted')} />);
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Nombre completo')).toBeTruthy();
    expect(screen.getByRole('button', { name: /solicitar acceso/i })).toBeTruthy();
    expect(screen.queryByLabelText(/rut/i)).toBeNull();
    expect(screen.queryByText(/transportista|generador|empresa/i)).toBeNull();
  });

  it('submit con campos vacíos muestra errores y NO llama submitRequest', async () => {
    const submitRequest = stub('submitted');
    render(<SignupForm submitRequest={submitRequest} />);
    await userEvent.click(screen.getByRole('button', { name: /solicitar acceso/i }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(submitRequest).not.toHaveBeenCalled();
  });

  // ALTA-2 (test-engineer): email malformado (no solo vacío) → hace
  // load-bearing el .email() del schema derivado. Sin esto, degradar el
  // resolver a z.string() quedaría verde.
  it('email malformado bloquea el submit y NO llama submitRequest', async () => {
    const submitRequest = stub('submitted');
    render(<SignupForm submitRequest={submitRequest} />);
    await userEvent.type(screen.getByLabelText('Email'), 'ana');
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Díaz');
    await userEvent.click(screen.getByRole('button', { name: /solicitar acceso/i }));
    expect(await screen.findByText(/ingresa un email válido/i)).toBeTruthy();
    expect(submitRequest).not.toHaveBeenCalled();
  });
});

describe('SignupForm — submit + mapeo de resultado (T5)', () => {
  async function fillAndSubmit() {
    await userEvent.type(screen.getByLabelText('Email'), 'ana@empresa.cl');
    await userEvent.type(screen.getByLabelText('Nombre completo'), 'Ana Díaz');
    await userEvent.click(screen.getByRole('button', { name: /solicitar acceso/i }));
  }

  it('submit válido llama submitRequest con {email, nombreCompleto}', async () => {
    const submitRequest = stub('submitted');
    render(<SignupForm submitRequest={submitRequest} />);
    await fillAndSubmit();
    expect(submitRequest).toHaveBeenCalledWith({
      email: 'ana@empresa.cl',
      nombreCompleto: 'Ana Díaz',
    });
  });

  it('por defecto usa postSignupRequest (integración fetch → /api/v1/signup-request)', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ status: 202 } as Response);
    render(<SignupForm />);
    await fillAndSubmit();
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.test/api/v1/signup-request',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('202 (submitted) → confirmación "solicitud en revisión", el form desaparece', async () => {
    render(<SignupForm submitRequest={stub('submitted')} />);
    await fillAndSubmit();
    expect((await screen.findByRole('status')).textContent).toMatch(/recibimos tu solicitud/i);
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it.each([
    ['rate_limited', /demasiados intentos/i],
    ['unavailable', /intenta más tarde/i],
    ['network_error', /no pudimos conectar/i],
    ['invalid', /revisa los datos/i],
  ] as const)('%s → error legible, el form permanece', async (outcome, re) => {
    render(<SignupForm submitRequest={stub(outcome)} />);
    await fillAndSubmit();
    const alert = await screen.findByText(re);
    expect(alert).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
});
