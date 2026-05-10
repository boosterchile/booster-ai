import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Auth } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enrollPhoneAsSecondFactorMock = vi.fn();
const listEnrolledSecondFactorsMock = vi.fn(
  () => [] as Array<{ uid: string; displayName: string | null; factorId: string }>,
);
const unenrollSecondFactorMock = vi.fn();

vi.mock('../../lib/two-factor.js', () => ({
  enrollPhoneAsSecondFactor: enrollPhoneAsSecondFactorMock,
  listEnrolledSecondFactors: listEnrolledSecondFactorsMock,
  unenrollSecondFactor: unenrollSecondFactorMock,
}));

vi.mock('../../lib/firebase.js', () => ({
  firebaseAuth: { __test__: true } as unknown as Auth,
}));

const { TwoFactorSection } = await import('./TwoFactorSection.js');

const FAKE_AUTH = { __test__: 'override' } as unknown as Auth;

beforeEach(() => {
  vi.clearAllMocks();
  listEnrolledSecondFactorsMock.mockReturnValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('TwoFactorSection — render', () => {
  it('sin factors → muestra mensaje "No tienes 2FA activado"', () => {
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    expect(screen.getByText(/No tienes 2FA activado/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tu teléfono/)).toBeInTheDocument();
  });

  it('con factors → lista cada uno con botón Desactivar', () => {
    listEnrolledSecondFactorsMock.mockReturnValue([
      { uid: 'f1', displayName: 'SMS +569****', factorId: 'phone' },
    ]);
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    expect(screen.getByText(/SMS \+569\*\*\*\*/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Desactivar/ })).toHaveLength(1);
  });

  it('factor sin displayName → muestra "Teléfono"', () => {
    listEnrolledSecondFactorsMock.mockReturnValue([
      { uid: 'f1', displayName: null, factorId: 'phone' },
    ]);
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    expect(screen.getByText(/Teléfono/)).toBeInTheDocument();
  });

  it('initialPhoneE164 prefill', () => {
    render(<TwoFactorSection authOverride={FAKE_AUTH} initialPhoneE164="+56987654321" />);
    expect(screen.getByLabelText(/Tu teléfono/)).toHaveValue('+56987654321');
  });
});

describe('TwoFactorSection — enroll flow', () => {
  it('teléfono inválido → error visible sin llamar enroll', async () => {
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: 'no-es-phone' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Teléfono inválido/);
    expect(enrollPhoneAsSecondFactorMock).not.toHaveBeenCalled();
  });

  it('happy path → llama enroll + muestra success + refresca lista', async () => {
    enrollPhoneAsSecondFactorMock.mockImplementation(async (opts: any) => {
      // Simula que el helper invoca promptSmsCode (no esperamos código real).
      void opts.promptSmsCode;
      return { ok: true };
    });
    listEnrolledSecondFactorsMock
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ uid: 'f1', displayName: 'SMS +569****', factorId: 'phone' }]);
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: '+56912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    expect(await screen.findByText(/2FA activado correctamente/)).toBeInTheDocument();
    expect(enrollPhoneAsSecondFactorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: FAKE_AUTH,
        phoneE164: '+56912345678',
        recaptchaContainerId: 'recaptcha-container-2fa',
      }),
    );
  });

  it('enroll devuelve reason no_user → mensaje específico', async () => {
    enrollPhoneAsSecondFactorMock.mockResolvedValueOnce({ ok: false, reason: 'no_user' });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: '+56912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Necesitas estar logueado/);
  });

  for (const [reason, regex] of [
    ['phone_invalid', /Formato esperado/],
    ['sms_cancelled', /Cancelaste el ingreso/],
    ['sms_invalid', /código SMS es incorrecto/],
    ['unknown', /Ocurrió un error/],
  ] as const) {
    it(`enroll reason=${reason} → ${regex}`, async () => {
      enrollPhoneAsSecondFactorMock.mockResolvedValueOnce({ ok: false, reason });
      render(<TwoFactorSection authOverride={FAKE_AUTH} />);
      fireEvent.change(screen.getByLabelText(/Tu teléfono/), {
        target: { value: '+56912345678' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
      expect(await screen.findByRole('alert')).toHaveTextContent(regex);
    });
  }
});

describe('TwoFactorSection — SMS prompt UI', () => {
  it('promptSmsCode abre dialog → confirmar resuelve con código', async () => {
    let resolveValue: string | null | undefined;
    enrollPhoneAsSecondFactorMock.mockImplementation(async (opts: any) => {
      resolveValue = await opts.promptSmsCode();
      return { ok: true };
    });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: '+56912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    const codeInput = await screen.findByPlaceholderText('123456');
    fireEvent.change(codeInput, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(resolveValue).toBe('654321'));
  });

  it('promptSmsCode cancelar → resuelve con null', async () => {
    let resolveValue: string | null | undefined;
    enrollPhoneAsSecondFactorMock.mockImplementation(async (opts: any) => {
      resolveValue = await opts.promptSmsCode();
      return { ok: false, reason: 'sms_cancelled' };
    });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: '+56912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    await screen.findByPlaceholderText('123456');
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/ }));
    await waitFor(() => expect(resolveValue).toBeNull());
  });

  it('confirmar sin código → botón disabled', async () => {
    enrollPhoneAsSecondFactorMock.mockImplementation(async (opts: any) => {
      void opts.promptSmsCode();
      return { ok: false, reason: 'sms_cancelled' };
    });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.change(screen.getByLabelText(/Tu teléfono/), { target: { value: '+56912345678' } });
    fireEvent.click(screen.getByRole('button', { name: /Activar 2FA/ }));
    await screen.findByPlaceholderText('123456');
    expect(screen.getByRole('button', { name: /Confirmar/ })).toBeDisabled();
  });
});

describe('TwoFactorSection — unenroll', () => {
  it('happy → llama unenroll + success + refresca', async () => {
    listEnrolledSecondFactorsMock
      .mockReturnValueOnce([{ uid: 'f1', displayName: 'SMS', factorId: 'phone' }])
      .mockReturnValueOnce([]);
    unenrollSecondFactorMock.mockResolvedValueOnce({ ok: true });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }));
    expect(await screen.findByText(/Factor desactivado/)).toBeInTheDocument();
    expect(unenrollSecondFactorMock).toHaveBeenCalledWith({ auth: FAKE_AUTH, factorUid: 'f1' });
  });

  it('unenroll falla → error visible', async () => {
    listEnrolledSecondFactorsMock.mockReturnValue([
      { uid: 'f1', displayName: 'SMS', factorId: 'phone' },
    ]);
    unenrollSecondFactorMock.mockResolvedValueOnce({ ok: false });
    render(<TwoFactorSection authOverride={FAKE_AUTH} />);
    fireEvent.click(screen.getByRole('button', { name: /Desactivar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo desactivar/);
  });
});
