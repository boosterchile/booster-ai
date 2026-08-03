import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/login/conductor` — activación del conductor.
 *
 * Reescrito tras la auditoría de 2026-08-01. La versión anterior fijaba en
 * verde un contrato que la Fase B (#641) eliminó: usaba el PIN como contraseña
 * de Firebase (`signInWithEmail(synthetic_email, pin)`). Hoy eso no puede
 * funcionar —la cuenta se crea sin password— y además mandaba el email REAL
 * del conductor junto al PIN que su empresa conoce.
 *
 * Contrato actual:
 *   · Conductor con PIN pendiente → activa acá y **elige su clave**.
 *   · Conductor ya activado (410) → entra por el login principal con RUT +
 *     clave numérica. Esta pantalla no intenta autenticarlo.
 */

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Navigate: ({ to }: { to: string }) => <div data-testid="nav" data-to={to} />,
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const signInDriverWithCustomTokenMock = vi.fn();
const signInWithEmailMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  signInDriverWithCustomToken: (...args: unknown[]) => signInDriverWithCustomTokenMock(...args),
  signInWithEmail: (...args: unknown[]) => signInWithEmailMock(...args),
}));

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  navigateMock.mockReset();
  signInDriverWithCustomTokenMock.mockReset();
  signInWithEmailMock.mockReset();
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const { LoginConductorRoute } = await import('./login-conductor.js');

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const RUT = '11.111.111-1';
const PIN = '123456';
const CLAVE = '482915';

async function completar(
  over: { rut?: string; pin?: string; clave?: string; repetir?: string } = {},
) {
  await userEvent.type(screen.getByLabelText(/^RUT/i), over.rut ?? RUT);
  await userEvent.type(screen.getByLabelText(/PIN/i), over.pin ?? PIN);
  await userEvent.type(screen.getByLabelText(/^Clave numérica/i), over.clave ?? CLAVE);
  await userEvent.type(
    screen.getByLabelText(/Repite tu clave/i),
    over.repetir ?? over.clave ?? CLAVE,
  );
}

describe('/login/conductor — activación', () => {
  it('pide RUT, PIN y la clave que el conductor elige', () => {
    render(<LoginConductorRoute />);
    expect(screen.getByLabelText(/^RUT/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/PIN/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Clave numérica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Repite tu clave/i)).toBeInTheDocument();
  });

  it('activa enviando la clave y entra a la app del conductor', async () => {
    fetchSpy.mockResolvedValue(
      makeJsonResponse(200, { custom_token: 'ct-1', synthetic_email: 'x@y.invalid' }),
    );

    render(<LoginConductorRoute />);
    await completar();
    await userEvent.click(screen.getByRole('button', { name: /Activar/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ rut: '11111111-1', pin: PIN, clave_numerica: CLAVE });

    await waitFor(() => expect(signInDriverWithCustomTokenMock).toHaveBeenCalledWith('ct-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app/conductor' }));
  });

  it('no envía nada si las dos claves no coinciden', async () => {
    render(<LoginConductorRoute />);
    await completar({ clave: '482915', repetir: '482916' });
    await userEvent.click(screen.getByRole('button', { name: /Activar/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no coinciden/i));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('410 ya activado → manda al login principal, NO intenta autenticar acá', async () => {
    fetchSpy.mockResolvedValue(
      makeJsonResponse(410, { error: 'already_activated', code: 'already_activated' }),
    );

    render(<LoginConductorRoute />);
    await completar();
    await userEvent.click(screen.getByRole('button', { name: /Activar/i }));

    // El defecto que esto reemplaza: intentaba `signInWithEmail(email, pin)`,
    // usando el PIN como contraseña. Esa vía ya no existe.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/ya (está|esta) activa/i),
    );
    expect(signInWithEmailMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('ir-al-login')).toHaveAttribute('href', '/login');
  });

  it('credenciales incorrectas → mensaje sin revelar qué falló', async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(401, { error: 'invalid_credentials' }));

    render(<LoginConductorRoute />);
    await completar();
    await userEvent.click(screen.getByRole('button', { name: /Activar/i }));

    const alerta = await screen.findByRole('alert');
    expect(alerta.textContent ?? '').toMatch(/RUT|PIN/i);
    // El backend colapsa rut-inexistente / pin-incorrecto en una sola
    // respuesta: la UI no inventa un diagnóstico que el backend evita dar.
    expect(alerta.textContent ?? '').not.toMatch(/no existe|no está registrado/i);
  });

  it('los campos numéricos abren el teclado numérico en el celular', () => {
    render(<LoginConductorRoute />);
    expect(screen.getByLabelText(/PIN/i)).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByLabelText(/^Clave numérica/i)).toHaveAttribute('inputmode', 'numeric');
  });

  it('503 not_a_driver → mensaje claro', async () => {
    fetchSpy.mockResolvedValue(makeJsonResponse(503, { code: 'not_a_driver' }));

    render(<LoginConductorRoute />);
    await completar();
    await userEvent.click(screen.getByRole('button', { name: /Activar/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});

describe('/login/conductor — accesibilidad', () => {
  it('no tiene violaciones de a11y (vitest-axe)', async () => {
    const { axe } = await import('vitest-axe');
    const { baseElement } = render(<LoginConductorRoute />);
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
