import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../lib/api-client.js';

const { SolicitarAccesoRoute } = await import('./solicitar-acceso.js');

const SUCCESS_MESSAGE = /Recibimos tu solicitud/;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('SolicitarAccesoRoute — render inicial', () => {
  it('muestra el form con nombre completo y email', () => {
    render(<SolicitarAccesoRoute />);
    expect(screen.getByLabelText(/Nombre completo/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Solicitar acceso/ })).toBeInTheDocument();
  });

  it('incluye link de vuelta a /login', () => {
    render(<SolicitarAccesoRoute />);
    const link = screen.getByTestId('solicitar-acceso-link-login');
    expect(link).toHaveAttribute('href', '/login');
  });
});

describe('SolicitarAccesoRoute — validación client-side (espejo del contrato)', () => {
  it('email inválido → error en el campo, NO llama al API', async () => {
    const postSpy = vi.spyOn(api, 'post');
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'no-es-un-email' } });
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Ingresa un correo válido/)).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('nombre completo vacío → error en el campo, NO llama al API', async () => {
    const postSpy = vi.spyOn(api, 'post');
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Ingresa tu nombre completo/)).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('email > 320 chars → error en el campo, NO llama al API', async () => {
    // Mismo dato que apps/api/src/routes/signup-request.test.ts (320 'a' +
    // '@x.cl' = 325 chars, supera el max(320) del contrato).
    const longEmail = `${'a'.repeat(320)}@x.cl`;
    const postSpy = vi.spyOn(api, 'post');
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: longEmail } });
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Ingresa un correo válido/)).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('SolicitarAccesoRoute — submit exitoso (anti-enumeración)', () => {
  it('happy path → POST /api/v1/signup-request + mensaje neutro de éxito', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({ ok: true });
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'felipe@empresa.cl' } });
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/signup-request', {
        nombreCompleto: 'Felipe Vicencio',
        email: 'felipe@empresa.cl',
      }),
    );
    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument();
  });

  it('mismo mensaje de éxito neutro aunque el email ya exista (shadow, 202 idéntico)', async () => {
    // El backend responde 202 {ok:true} idéntico tanto si el email ya
    // existía como si no (anti-enumeration, SC-1.2.5) — el frontend no
    // puede ni debe distinguir el caso, así que solo verificamos que el
    // copy no cambia según ningún detalle de la respuesta.
    vi.spyOn(api, 'post').mockResolvedValueOnce({ ok: true });
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Existente' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), {
      target: { value: 'existente@cliente.cl' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));

    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument();
    expect(
      screen.queryByText(/ya existe|ya está registrado|already exists/i),
    ).not.toBeInTheDocument();
  });
});

describe('SolicitarAccesoRoute — manejo de errores por status/code', () => {
  beforeEach(() => {
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'felipe@empresa.cl' } });
  });

  it('429 → "Demasiados intentos, espera unos minutos"', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(429, 'rate_limited', null));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Demasiados intentos, espera unos minutos/)).toBeInTheDocument();
  });

  it('422 (contrato citado por el brief) → mensaje de validación', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(422, undefined, null));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Revisa los datos ingresados/)).toBeInTheDocument();
  });

  it('400 (comportamiento real verificado en signup-request.test.ts del backend) → mensaje de validación', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError(400, undefined, null));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Revisa los datos ingresados/)).toBeInTheDocument();
  });

  it('503 { error: service_unavailable } → mensaje genérico de reintento', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(503, 'service_unavailable', { error: 'service_unavailable' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(
      await screen.findByText(/No pudimos procesar tu solicitud, intenta más tarde/),
    ).toBeInTheDocument();
  });

  it('error no-ApiError (network) → mensaje genérico de reintento', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('network down'));
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(
      await screen.findByText(/No pudimos procesar tu solicitud, intenta más tarde/),
    ).toBeInTheDocument();
  });
});

describe('SolicitarAccesoRoute — 400/422 mapeado por campo (setError vs banner genérico)', () => {
  beforeEach(() => {
    render(<SolicitarAccesoRoute />);
    fireEvent.change(screen.getByLabelText(/Nombre completo/), {
      target: { value: 'Felipe Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'felipe@empresa.cl' } });
  });

  it('400 con issues de zod sobre email → error asociado al campo, no banner genérico', async () => {
    // Shape real del default de @hono/zod-validator (verificado contra
    // apps/api/src/routes/signup-request.ts): `{ success: false, error: {
    // issues: [{ path, message, code }], name: 'ZodError' } }`.
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(400, undefined, {
        success: false,
        error: {
          issues: [{ path: ['email'], message: 'Invalid email', code: 'invalid_string' }],
          name: 'ZodError',
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Ingresa un correo válido/)).toBeInTheDocument();
    expect(screen.queryByText(/Revisa los datos ingresados/)).not.toBeInTheDocument();
  });

  it('400 con shape no mapeable (payload inesperado) → banner genérico', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(400, undefined, { unexpected: 'shape' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Revisa los datos ingresados/)).toBeInTheDocument();
    expect(screen.queryByText(/Ingresa un correo válido/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ingresa tu nombre completo/)).not.toBeInTheDocument();
  });

  it('400 con issue de path desconocido (no email/nombreCompleto) → banner genérico', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(400, undefined, {
        success: false,
        error: { issues: [{ path: ['otroCampo'], message: 'algo raro' }], name: 'ZodError' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Solicitar acceso/ }));
    expect(await screen.findByText(/Revisa los datos ingresados/)).toBeInTheDocument();
  });
});
