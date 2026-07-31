import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

/**
 * equipo-de-la-empresa Fase A — pantalla de activación.
 *
 * La usa alguien que su empresa dio de alta: llega con un código de un solo
 * uso y sale con SU clave, que nadie más conoce. Es el punto donde el
 * principio de identidad deja de ser una frase de la spec y se vuelve algo que
 * la persona hace con sus manos.
 */

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const signInWithCustomTokenMock = vi.fn(async (_token: string) => undefined);
vi.mock('../lib/firebase.js', () => ({ firebaseAuth: {} }));
vi.mock('firebase/auth', () => ({
  signInWithCustomToken: (_auth: unknown, token: string) => signInWithCustomTokenMock(token),
}));

const { ActivarRoute } = await import('./activar.js');

function completar(
  overrides: { rut?: string; codigo?: string; clave?: string; repetir?: string } = {},
) {
  fireEvent.change(screen.getByLabelText(/^RUT/i), {
    target: { value: overrides.rut ?? '8.601.693-1' },
  });
  fireEvent.change(screen.getByLabelText(/Código/i), {
    target: { value: overrides.codigo ?? '135790' },
  });
  fireEvent.change(screen.getByLabelText(/^Clave numérica/i), {
    target: { value: overrides.clave ?? '482915' },
  });
  fireEvent.change(screen.getByLabelText(/Repite tu clave/i), {
    target: { value: overrides.repetir ?? overrides.clave ?? '482915' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Activar cuenta', () => {
  it('pide RUT, código y la clave que la persona elige', () => {
    render(<ActivarRoute />);
    expect(screen.getByLabelText(/^RUT/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Código/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Clave numérica/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Repite tu clave/i)).toBeInTheDocument();
  });

  it('activa, firma la sesión y entra a la app', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      activated: true,
      custom_token: 'ct-activacion',
    } as never);

    render(<ActivarRoute />);
    completar();
    fireEvent.click(screen.getByRole('button', { name: /Activar mi cuenta/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/auth/activar', {
        rut: '8601693-1',
        codigo: '135790',
        clave_numerica: '482915',
      }),
    );
    await waitFor(() => expect(signInWithCustomTokenMock).toHaveBeenCalledWith('ct-activacion'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app' }));
  });

  it('no envía nada si las dos claves no coinciden', async () => {
    const post = vi.spyOn(api, 'post');

    render(<ActivarRoute />);
    completar({ clave: '482915', repetir: '482916' });
    fireEvent.click(screen.getByRole('button', { name: /Activar mi cuenta/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no coinciden/i));
    expect(post).not.toHaveBeenCalled();
  });

  it('un rechazo del backend se muestra sin revelar qué falló', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('unauthorized'), { code: 'invalid_credentials', status: 401 }),
    );

    render(<ActivarRoute />);
    completar();
    fireEvent.click(screen.getByRole('button', { name: /Activar mi cuenta/i }));

    // El backend colapsa rut-inexistente / código-malo / vencido en una sola
    // respuesta; la UI no debe inventar un diagnóstico que el backend evita dar.
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/revisa.*rut.*código|código.*no.*válido/i);
    expect(alerta.textContent ?? '').not.toMatch(/no existe|ya (fue|está) activad|vencid/i);
  });

  it('si la activación funciona pero no llega la sesión, guía al login', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true, activated: true } as never);

    render(<ActivarRoute />);
    completar();
    fireEvent.click(screen.getByRole('button', { name: /Activar mi cuenta/i }));

    // La cuenta quedó activa: entra con su RUT y la clave que acaba de crear.
    expect(await screen.findByText(/ya podés entrar|ya puedes entrar/i)).toBeInTheDocument();
    expect(signInWithCustomTokenMock).not.toHaveBeenCalled();
  });
});
