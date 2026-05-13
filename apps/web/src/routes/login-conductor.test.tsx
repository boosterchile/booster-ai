import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Navigate: ({ to }: { to: string }) => <div data-testid="nav" data-to={to} />,
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
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

describe('LoginConductorRoute', () => {
  it('RUT inválido → muestra error sin llamar API', async () => {
    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-9');
    await userEvent.type(screen.getByLabelText(/^PIN/), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    // El error de dígito verificador del rutSchema aparece bajo el field.
    await waitFor(() => expect(screen.getByText(/Dígito verificador/i)).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('200 + custom_token → signInWithCustomToken + navigate a /app/conductor', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(200, {
        custom_token: 'tok-xyz',
        synthetic_email: 'drivers+1@boosterchile.invalid',
      }),
    );
    signInDriverWithCustomTokenMock.mockResolvedValueOnce({ uid: 'fb-1' });

    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^PIN/), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    await waitFor(() => expect(signInDriverWithCustomTokenMock).toHaveBeenCalledWith('tok-xyz'));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/app/conductor' });
  });

  it('410 already_activated → fallback signInWithEmail con synthetic_email', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(410, {
        code: 'already_activated',
        synthetic_email: 'drivers+11111111@boosterchile.invalid',
      }),
    );
    signInWithEmailMock.mockResolvedValueOnce({ uid: 'fb-1' });

    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^PIN/), '987654');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    await waitFor(() =>
      expect(signInWithEmailMock).toHaveBeenCalledWith(
        'drivers+11111111@boosterchile.invalid',
        '987654',
      ),
    );
    expect(navigateMock).toHaveBeenCalledWith({ to: '/app/conductor' });
  });

  it('410 + signInWithEmail falla → "PIN o contraseña incorrectos"', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(410, {
        code: 'already_activated',
        synthetic_email: 'drivers+xyz@boosterchile.invalid',
      }),
    );
    signInWithEmailMock.mockRejectedValueOnce(new Error('wrong-password'));

    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^PIN/), '111111');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    await waitFor(() =>
      expect(screen.getByText(/PIN o contraseña incorrectos/)).toBeInTheDocument(),
    );
  });

  it('503 not_a_driver → mensaje específico', async () => {
    fetchSpy.mockResolvedValueOnce(makeJsonResponse(503, { code: 'not_a_driver' }));

    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^PIN/), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    await waitFor(() =>
      expect(screen.getByText(/no está habilitado como conductor/)).toBeInTheDocument(),
    );
  });

  it('401 → mensaje genérico de credenciales', async () => {
    fetchSpy.mockResolvedValueOnce(makeJsonResponse(401, { code: 'invalid_credentials' }));

    render(<LoginConductorRoute />);
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^PIN/), '000000');
    await userEvent.click(screen.getByRole('button', { name: /Ingresar/ }));

    await waitFor(() => expect(screen.getByText(/RUT o PIN incorrectos/)).toBeInTheDocument());
  });
});
