import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
const signInWithGoogleMock = vi.fn();
const signInWithEmailMock = vi.fn();
const signUpWithEmailMock = vi.fn();
const requestPasswordResetMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  useAuth: useAuthMock,
  signInWithGoogle: signInWithGoogleMock,
  signInWithEmail: signInWithEmailMock,
  signUpWithEmail: signUpWithEmailMock,
  requestPasswordReset: requestPasswordResetMock,
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const { LoginRoute } = await import('./login.js');

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginRoute — auth state', () => {
  it('user presente → redirige a /app', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    render(<LoginRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app');
  });

  it('user null + loading → render form', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<LoginRoute />);
    expect(screen.getByRole('button', { name: /Continuar con Google/ })).toBeInTheDocument();
  });
});

describe('LoginRoute — Google sign in', () => {
  it('click Google → signInWithGoogle + navigate /app', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    signInWithGoogleMock.mockResolvedValueOnce(undefined);
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });

  it('Google popup cancelado → no error visible', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    signInWithGoogleMock.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'auth/popup-closed-by-user' }),
    );
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    await waitFor(() => expect(signInWithGoogleMock).toHaveBeenCalled());
    expect(screen.queryByText(/No pudimos iniciar sesión/)).not.toBeInTheDocument();
  });

  it('Google error otro código → muestra mensaje genérico', async () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    signInWithGoogleMock.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'auth/network-request-failed' }),
    );
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Continuar con Google/ }));
    expect(await screen.findByText(/Sin conexión a internet/)).toBeInTheDocument();
  });
});

describe('LoginRoute — sign in con email/password', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
  });

  it('email inválido → error en input email', async () => {
    render(<LoginRoute />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'no-email' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/ }));
    expect(await screen.findByText(/Email inválido/)).toBeInTheDocument();
  });

  it('password < 6 → error password', async () => {
    render(<LoginRoute />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/Contraseña/), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/ }));
    expect(await screen.findByText(/Mínimo 6 caracteres/)).toBeInTheDocument();
  });

  it('happy → signInWithEmail + navigate', async () => {
    signInWithEmailMock.mockResolvedValueOnce(undefined);
    render(<LoginRoute />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/ }));
    await waitFor(() => expect(signInWithEmailMock).toHaveBeenCalledWith('a@b.cl', '123456'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });

  it('error wrong-password → mensaje traducido', async () => {
    signInWithEmailMock.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'auth/wrong-password' }),
    );
    render(<LoginRoute />);
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Entrar/ }));
    expect(await screen.findByText(/Contraseña incorrecta/)).toBeInTheDocument();
  });
});

describe('LoginRoute — sign up mode', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
  });

  it('switch a sign-up → muestra campo Nombre', () => {
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Crea una/ }));
    expect(screen.getByLabelText(/^Tu nombre/)).toBeInTheDocument();
  });

  it('sign-up sin nombre → error', async () => {
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Crea una/ }));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/ }));
    expect(await screen.findByText(/Ingresa tu nombre/)).toBeInTheDocument();
  });

  it('sign-up happy → signUpWithEmail + navigate', async () => {
    signUpWithEmailMock.mockResolvedValueOnce(undefined);
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Crea una/ }));
    fireEvent.change(screen.getByLabelText(/Tu nombre/), { target: { value: 'Felipe' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.change(screen.getByLabelText(/^Contraseña/), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/ }));
    await waitFor(() =>
      expect(signUpWithEmailMock).toHaveBeenCalledWith({
        email: 'a@b.cl',
        password: '123456',
        displayName: 'Felipe',
      }),
    );
  });
});

describe('LoginRoute — reset password', () => {
  beforeEach(() => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
  });

  it('switch a reset → muestra solo email', () => {
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Olvidé mi contraseña/ }));
    expect(screen.queryByLabelText(/^Contraseña/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar link/ })).toBeInTheDocument();
  });

  it('reset envía email + muestra confirmación', async () => {
    requestPasswordResetMock.mockResolvedValueOnce(undefined);
    render(<LoginRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Olvidé mi contraseña/ }));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'a@b.cl' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar link/ }));
    expect(await screen.findByText(/te llegó un email/i)).toBeInTheDocument();
  });
});
