import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';
import { logger } from '../lib/logger.js';

/**
 * T9 (`.specs/confirmar-acceso-booster/spec.md`, SC18) — la persona confirma
 * con su sesión el código que le entregó en persona el admin de Booster.
 */

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type ProtectedContext =
  | { kind: 'onboarded'; me: MeOnboarded }
  | { kind: 'pre-onboarding'; me: Extract<MeResponse, { needs_onboarding: true }> }
  | { kind: 'unmanaged' };

let providedContext: ProtectedContext = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: ProtectedContext) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

const navigateMock = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const { ConfirmarAccesoBoosterRoute } = await import('./confirmar-acceso-booster.js');

const USER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CODIGO = '604218';
const CODIGO_NO_SIRVE = 'El código no es válido o venció. Pide uno nuevo al equipo de Booster.';

function makeMe(over: Partial<MeOnboarded['user']> = {}): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: USER_ID,
      email: 'ana@transportesuno.cl',
      full_name: 'Ana Rojas',
      phone: null,
      whatsapp_e164: null,
      rut: '11111111-1',
      is_platform_admin: false,
      status: 'activo',
      ...over,
    },
    memberships: [],
    active_membership: null,
  };
}

function renderPantalla() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ConfirmarAccesoBoosterRoute />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function campoCodigo(): HTMLInputElement {
  return screen.getByLabelText('Código de confirmación') as HTMLInputElement;
}

function confirmarCon(codigo: string) {
  fireEvent.change(campoCodigo(), { target: { value: codigo } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar acceso' }));
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  providedContext = { kind: 'onboarded', me: makeMe() };
});

describe('/app/confirmar-acceso-booster — pantalla (SC18)', () => {
  it('sin un contexto con cuenta no muestra nada', () => {
    providedContext = { kind: 'unmanaged' };
    renderPantalla();
    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
  });

  it('va dentro del Layout con un campo de 6 números y el botón Confirmar acceso', () => {
    renderPantalla();

    expect(screen.getByTestId('layout')).toHaveAttribute(
      'data-title',
      'Confirmar acceso de Booster',
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirmar acceso de Booster' }),
    ).toBeInTheDocument();
    const campo = campoCodigo();
    expect(campo).toHaveAttribute('inputmode', 'numeric');
    expect(campo).toHaveAttribute('maxlength', '6');
    expect(campo).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByRole('button', { name: 'Confirmar acceso' })).toBeEnabled();
  });

  it('el campo deja solo los números', () => {
    renderPantalla();
    fireEvent.change(campoCodigo(), { target: { value: '60 42-1a8' } });
    expect(campoCodigo()).toHaveValue(CODIGO);
  });

  it('valida el código antes de llamar al API', async () => {
    renderPantalla();
    const post = vi.spyOn(api, 'post');

    confirmarCon('6042');

    expect(await screen.findByRole('alert')).toHaveTextContent('El código tiene 6 números');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('/app/confirmar-acceso-booster — confirmar (SC18)', () => {
  it('manda el código, refresca /me y recién entonces lleva al panel', async () => {
    const { invalidate } = renderPantalla();
    let terminarRefresco: () => void = () => undefined;
    invalidate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          terminarRefresco = resolve;
        }),
    );
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true, user_id: USER_ID });

    confirmarCon(CODIGO);

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me'] }));
    expect(post.mock.calls).toEqual([['/me/confirmar-acceso-booster', { codigo: CODIGO }]]);
    expect(navigateMock).not.toHaveBeenCalled();

    terminarRefresco();

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/app/platform-admin' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('mientras confirma, el botón queda deshabilitado', async () => {
    renderPantalla();
    vi.spyOn(api, 'post').mockReturnValue(new Promise(() => undefined));

    confirmarCon(CODIGO);

    expect(await screen.findByRole('button', { name: 'Confirmando…' })).toBeDisabled();
  });

  it.each([
    ['codigo_invalido', new ApiError(400, 'codigo_invalido', {}, 'codigo_invalido')],
    ['el validador del API', new ApiError(400, 'validation_error', {}, 'codigo: inválido')],
  ])('un 400 (%s) se lee con el mensaje único y no lleva al panel', async (_caso, err) => {
    const { invalidate } = renderPantalla();
    vi.spyOn(api, 'post').mockRejectedValue(err);

    confirmarCon(CODIGO);

    expect(await screen.findByRole('alert')).toHaveTextContent(CODIGO_NO_SIRVE);
    expect(invalidate).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirmar acceso' })).toBeEnabled();
  });

  it('en una sesión de impersonación pide salir de ella', async () => {
    renderPantalla();
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(
        403,
        'forbidden_impersonation_write',
        { error: 'forbidden_impersonation_write' },
        'forbidden_impersonation_write',
      ),
    );

    confirmarCon(CODIGO);

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Estás viendo la plataforma como otra persona.');
    expect(alerta).not.toHaveTextContent(CODIGO_NO_SIRVE);
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('con la sesión vencida pide volver a iniciarla', async () => {
    renderPantalla();
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(401, undefined, { error: 'unauthorized' }, 'unauthorized'),
    );

    confirmarCon(CODIGO);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu sesión venció. Vuelve a iniciar sesión.',
    );
  });

  it('otro error del servidor se muestra con su estado y se reporta sin el código', async () => {
    renderPantalla();
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(500, undefined, {}, 'internal'));

    confirmarCon(CODIGO);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos confirmar el acceso (500). Intenta de nuevo en un momento.',
    );
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(CODIGO);
  });

  it('un error de red se muestra y se reporta sin el código', async () => {
    renderPantalla();
    vi.spyOn(api, 'post').mockRejectedValue(new TypeError('Failed to fetch'));

    confirmarCon(CODIGO);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No pudimos confirmar el acceso. Revisa tu conexión e intenta de nuevo.',
    );
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(CODIGO);
  });

  it('una respuesta con formato inesperado se reporta y no lleva al panel', async () => {
    const { invalidate } = renderPantalla();
    vi.spyOn(api, 'post').mockResolvedValue({ ok: true });

    confirmarCon(CODIGO);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La respuesta del servidor no tiene el formato esperado.',
    );
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(CODIGO);
    expect(invalidate).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe('/app/confirmar-acceso-booster — cuenta con acceso (SC18)', () => {
  it('si la cuenta ya tiene acceso al panel lo dice y no muestra el formulario', () => {
    providedContext = { kind: 'onboarded', me: makeMe({ is_platform_admin: true }) };
    renderPantalla();

    expect(screen.getByText('Tu cuenta ya tiene acceso al panel de Booster.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al panel de Booster' })).toHaveAttribute(
      'href',
      '/app/platform-admin',
    );
    expect(screen.queryByLabelText('Código de confirmación')).not.toBeInTheDocument();
  });
});
