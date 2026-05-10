import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
const getLinkedProvidersMock = vi.fn();
const linkGoogleProviderMock = vi.fn();
const linkPasswordProviderMock = vi.fn();
const reauthCurrentMock = vi.fn();
const unlinkProviderMock = vi.fn();
const updatePasswordCurrentMock = vi.fn();

vi.mock('../../hooks/use-auth.js', () => ({
  useAuth: useAuthMock,
  getLinkedProviders: getLinkedProvidersMock,
  linkGoogleProvider: linkGoogleProviderMock,
  linkPasswordProvider: linkPasswordProviderMock,
  reauthCurrent: reauthCurrentMock,
  unlinkProvider: unlinkProviderMock,
  updatePasswordCurrent: updatePasswordCurrentMock,
}));

const { AuthProvidersSection } = await import('./AuthProvidersSection.js');

function makeUser(over: Partial<User> = {}): User {
  return {
    email: 'felipe@boosterchile.com',
    reload: vi.fn(async () => undefined),
    ...over,
  } as unknown as User;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthProvidersSection — guard', () => {
  it('user null → render null', () => {
    useAuthMock.mockReturnValue({ user: null });
    const { container } = render(<AuthProvidersSection />);
    expect(container.firstChild).toBeNull();
  });
});

describe('AuthProvidersSection — Google linked / unlinked', () => {
  it('hasGoogle=false → muestra "No vinculada" y botón Vincular', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['password']);
    render(<AuthProvidersSection />);
    expect(screen.getByText('No vinculada')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Vincular/ }).length).toBeGreaterThan(0);
  });

  it('hasGoogle=true (único) → no muestra Quitar', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    render(<AuthProvidersSection />);
    expect(screen.getAllByText(/Vinculada con/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });

  it('hasGoogle=true + más de 1 → muestra Quitar', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com', 'password']);
    render(<AuthProvidersSection />);
    expect(screen.getAllByRole('button', { name: 'Quitar' }).length).toBeGreaterThanOrEqual(1);
  });
});

describe('AuthProvidersSection — link Google', () => {
  it('happy: link + reload + refresh', async () => {
    const user = makeUser();
    useAuthMock.mockReturnValue({ user });
    getLinkedProvidersMock
      .mockReturnValueOnce(['password'])
      .mockReturnValue(['google.com', 'password']);
    linkGoogleProviderMock.mockResolvedValueOnce(undefined);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getAllByRole('button', { name: /Vincular/ })[0]!);
    await waitFor(() => expect(linkGoogleProviderMock).toHaveBeenCalledWith(user));
    await waitFor(() => expect(user.reload).toHaveBeenCalled());
  });

  it('popup cerrado por user → no error visible', async () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['password']);
    linkGoogleProviderMock.mockRejectedValueOnce(
      Object.assign(new Error('popup'), { code: 'auth/popup-closed-by-user' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getAllByRole('button', { name: /Vincular/ })[0]!);
    await waitFor(() => expect(linkGoogleProviderMock).toHaveBeenCalled());
    expect(screen.queryByText(/No pudimos vincular/)).not.toBeInTheDocument();
  });

  it('error popup-blocked → mensaje traducido', async () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['password']);
    linkGoogleProviderMock.mockRejectedValueOnce(
      Object.assign(new Error('blocked'), { code: 'auth/popup-blocked' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getAllByRole('button', { name: /Vincular/ })[0]!);
    expect(await screen.findByText(/El navegador bloqueó/)).toBeInTheDocument();
  });

  it('error code desconocido → fallback "No pudimos vincular"', async () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['password']);
    linkGoogleProviderMock.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { code: 'auth/something-else' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getAllByRole('button', { name: /Vincular/ })[0]!);
    expect(await screen.findByText(/No pudimos vincular/)).toBeInTheDocument();
  });
});

describe('AuthProvidersSection — unlink', () => {
  it('click Quitar → unlinkProvider + reload', async () => {
    const user = makeUser();
    useAuthMock.mockReturnValue({ user });
    getLinkedProvidersMock.mockReturnValue(['google.com', 'password']);
    unlinkProviderMock.mockResolvedValueOnce(undefined);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0]!);
    await waitFor(() => expect(unlinkProviderMock).toHaveBeenCalledWith(user, expect.any(String)));
  });
});

describe('AuthProvidersSection — PasswordLinkForm', () => {
  it('hasPassword=false → muestra card "Email + contraseña" con botón Agregar', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    render(<AuthProvidersSection />);
    expect(screen.getByText(/Agregá una contraseña/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agregar/ })).toBeInTheDocument();
  });

  it('click Agregar → abre form con email prefill', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    expect(screen.getByLabelText(/^Email/)).toHaveValue('felipe@boosterchile.com');
    expect(screen.getByLabelText(/Contraseña nueva/)).toBeInTheDocument();
  });

  it('cancelar cierra form', () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('submit happy → linkPasswordProvider + reload + cerrar form', async () => {
    const user = makeUser();
    useAuthMock.mockReturnValue({ user });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    linkPasswordProviderMock.mockResolvedValueOnce(undefined);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    fireEvent.change(screen.getByLabelText(/Contraseña nueva/), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await waitFor(() =>
      expect(linkPasswordProviderMock).toHaveBeenCalledWith(
        user,
        'felipe@boosterchile.com',
        'secret123',
      ),
    );
  });

  it('error requires-recent-login → muestra mensaje + botón Re-autenticar', async () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    linkPasswordProviderMock.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'auth/requires-recent-login' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    fireEvent.change(screen.getByLabelText(/Contraseña nueva/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText(/confirmar tu identidad/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Re-autenticar y vincular/ })).toBeInTheDocument();
  });

  it('Re-autenticar → reauthCurrent + retry link', async () => {
    const user = makeUser();
    useAuthMock.mockReturnValue({ user });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    linkPasswordProviderMock
      .mockRejectedValueOnce(Object.assign(new Error(''), { code: 'auth/requires-recent-login' }))
      .mockResolvedValueOnce(undefined);
    reauthCurrentMock.mockResolvedValueOnce(undefined);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    fireEvent.change(screen.getByLabelText(/Contraseña nueva/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    await screen.findByRole('button', { name: /Re-autenticar y vincular/ });
    fireEvent.click(screen.getByRole('button', { name: /Re-autenticar y vincular/ }));
    await waitFor(() => expect(reauthCurrentMock).toHaveBeenCalledWith(user, { type: 'google' }));
    await waitFor(() => expect(linkPasswordProviderMock).toHaveBeenCalledTimes(2));
  });

  it('error genérico durante link → mensaje fallback', async () => {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['google.com']);
    linkPasswordProviderMock.mockRejectedValueOnce(
      Object.assign(new Error(''), { code: 'auth/network-request-failed' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar/ }));
    fireEvent.change(screen.getByLabelText(/Contraseña nueva/), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vincular' }));
    expect(await screen.findByText(/Sin conexión a internet/)).toBeInTheDocument();
  });
});

describe('AuthProvidersSection — ChangePasswordForm', () => {
  function setupHasPassword() {
    useAuthMock.mockReturnValue({ user: makeUser() });
    getLinkedProvidersMock.mockReturnValue(['password', 'google.com']);
  }

  it('muestra card "Cambiar contraseña" + botón Cambiar', () => {
    setupHasPassword();
    render(<AuthProvidersSection />);
    expect(screen.getAllByText(/Cambiar contraseña/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Cambiar' })).toBeInTheDocument();
  });

  it('click Cambiar abre form con 3 inputs', () => {
    setupHasPassword();
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    expect(screen.getByLabelText(/^Contraseña actual/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Nueva contraseña/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Confirmar nueva contraseña/)).toBeInTheDocument();
  });

  it('happy: reauth + updatePassword + cierra form con success', async () => {
    const user = makeUser();
    useAuthMock.mockReturnValue({ user });
    getLinkedProvidersMock.mockReturnValue(['password', 'google.com']);
    reauthCurrentMock.mockResolvedValueOnce(undefined);
    updatePasswordCurrentMock.mockResolvedValueOnce(undefined);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: 'old123!' } });
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirmar nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    await waitFor(() => expect(updatePasswordCurrentMock).toHaveBeenCalled());
    expect(await screen.findByText('Contraseña actualizada.')).toBeInTheDocument();
  });

  it('contraseña actual incorrecta → error en input currentPassword', async () => {
    setupHasPassword();
    reauthCurrentMock.mockRejectedValueOnce(
      Object.assign(new Error('wrong'), { code: 'auth/wrong-password' }),
    );
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirmar nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText(/Contraseña actual incorrecta/)).toBeInTheDocument();
  });

  it('confirmPassword no coincide → error de validación', async () => {
    setupHasPassword();
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: 'old' } });
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirmar nueva contraseña/), {
      target: { value: 'OtraCosa1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText(/No coincide/)).toBeInTheDocument();
  });

  it('user sin email → error "Tu cuenta no tiene un email asociado"', async () => {
    useAuthMock.mockReturnValue({ user: makeUser({ email: null } as never) });
    getLinkedProvidersMock.mockReturnValue(['password', 'google.com']);
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.change(screen.getByLabelText(/^Contraseña actual/), { target: { value: 'a' } });
    fireEvent.change(screen.getByLabelText(/^Nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirmar nueva contraseña/), {
      target: { value: 'NewPass123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText(/no tiene un email asociado/)).toBeInTheDocument();
  });

  it('cancelar cierra form', () => {
    setupHasPassword();
    render(<AuthProvidersSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Contraseña actual')).not.toBeInTheDocument();
  });
});
