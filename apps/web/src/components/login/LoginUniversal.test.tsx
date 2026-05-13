import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del LoginUniversal (ADR-035 — Wave 4 PR 2).
 *
 * Cubre:
 *   - Selector visible cuando no hay query param tipo.
 *   - Pre-selección desde ?tipo=transporte
 *   - Form RUT + clave numérica
 *   - Validación de RUT inválido y clave no-6-dígitos
 *   - 200 → custom_token → signInUniversalWithCustomToken + navigate /app
 *   - 401 → mensaje "RUT o clave incorrectos"
 *   - 410 needs_rotation → vista de rotación con link a legacy
 */

const navigateMock = vi.fn();
const useSearchMock = vi.fn(() => ({}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useSearch: () => useSearchMock(),
}));

const signInUniversalWithCustomTokenMock = vi.fn();
vi.mock('../../hooks/use-auth.js', () => ({
  signInUniversalWithCustomToken: signInUniversalWithCustomTokenMock,
}));

vi.mock('../../lib/api-url.js', () => ({
  getApiUrl: () => 'http://test',
}));

const { LoginUniversal } = await import('./LoginUniversal.js');

const fetchSpy = vi.fn();

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSearchMock.mockReturnValue({});
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LoginUniversal', () => {
  it('sin ?tipo → renderiza selector con las 5 opciones', () => {
    render(<LoginUniversal />);
    expect(screen.getByTestId('login-universal-selector')).toBeInTheDocument();
    expect(screen.getByTestId('login-tipo-carga')).toBeInTheDocument();
    expect(screen.getByTestId('login-tipo-transporte')).toBeInTheDocument();
    expect(screen.getByTestId('login-tipo-conductor')).toBeInTheDocument();
    expect(screen.getByTestId('login-tipo-stakeholder')).toBeInTheDocument();
    expect(screen.getByTestId('login-tipo-booster')).toBeInTheDocument();
  });

  it('click en tipo Transporte → muestra form', async () => {
    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-transporte'));
    expect(screen.getByTestId('login-universal-form')).toBeInTheDocument();
    // El label del form usa la etiqueta humana del tipo.
    expect(screen.getByText('Transporte')).toBeInTheDocument();
  });

  it('?tipo=conductor en URL → entra directo al form pre-seleccionado', () => {
    useSearchMock.mockReturnValue({ tipo: 'conductor' });
    render(<LoginUniversal />);
    expect(screen.getByTestId('login-universal-form')).toBeInTheDocument();
    expect(screen.getByText('Conductor')).toBeInTheDocument();
  });

  it('RUT mal formado → muestra error sin llamar fetch', async () => {
    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-conductor'));
    await userEvent.type(screen.getByTestId('login-rut-input'), 'no-es-rut');
    await userEvent.type(screen.getByTestId('login-clave-input'), '123456');
    await userEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clave de 5 dígitos no se acepta (input maxLength=6 + filter numérico)', async () => {
    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-conductor'));
    const claveInput = screen.getByTestId('login-clave-input') as HTMLInputElement;
    await userEvent.type(claveInput, 'abc'); // letras filtradas
    expect(claveInput.value).toBe('');
    await userEvent.type(claveInput, '1234567'); // 7 dígitos → corta a 6
    expect(claveInput.value).toBe('123456');
  });

  it('200 + custom_token → signInUniversalWithCustomToken + navigate a /app', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(200, {
        custom_token: 'tok-abc',
        synthetic_email: 'users+11111111@boosterchile.invalid',
        auth_method: 'rut_clave',
      }),
    );
    signInUniversalWithCustomTokenMock.mockResolvedValueOnce({ uid: 'fb-1' });

    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-transporte'));
    fireEvent.change(screen.getByTestId('login-rut-input'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByTestId('login-clave-input'), { target: { value: '123456' } });
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(signInUniversalWithCustomTokenMock).toHaveBeenCalledWith('tok-abc'));
    expect(navigateMock).toHaveBeenCalledWith({ to: '/app' });
  });

  it('401 → mensaje "RUT o clave incorrectos"', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(401, { error: 'invalid_credentials', code: 'invalid_credentials' }),
    );

    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-conductor'));
    await userEvent.type(screen.getByTestId('login-rut-input'), '11.111.111-1');
    fireEvent.change(screen.getByTestId('login-clave-input'), { target: { value: '654321' } });
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(screen.getByText(/RUT o clave incorrectos/i)).toBeInTheDocument());
    expect(signInUniversalWithCustomTokenMock).not.toHaveBeenCalled();
  });

  it('410 needs_rotation → renderiza vista de rotación con link a legacy', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeJsonResponse(410, {
        error: 'needs_rotation',
        code: 'needs_rotation',
        message: 'Tu cuenta todavía no tiene clave.',
      }),
    );

    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-carga'));
    fireEvent.change(screen.getByTestId('login-rut-input'), {
      target: { value: '11.111.111-1' },
    });
    fireEvent.change(screen.getByTestId('login-clave-input'), { target: { value: '123456' } });
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() =>
      expect(screen.getByText(/Tu cuenta todavía no tiene clave/i)).toBeInTheDocument(),
    );
    const legacyLink = screen.getByTestId('needs-rotation-go-legacy');
    expect(legacyLink).toHaveAttribute('href', '/login?legacy=1');
  });

  it('botón "Cambiar tipo de usuario" en form vuelve al selector', async () => {
    render(<LoginUniversal />);
    await userEvent.click(screen.getByTestId('login-tipo-stakeholder'));
    expect(screen.getByTestId('login-universal-form')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('login-back-to-selector'));
    expect(screen.getByTestId('login-universal-selector')).toBeInTheDocument();
  });
});
