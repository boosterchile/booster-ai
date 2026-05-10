import type { Auth, MultiFactorError } from 'firebase/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const verifyPhoneNumberMock = vi.fn();
const getSessionMock = vi.fn();
const enrollMock = vi.fn();
const unenrollMock = vi.fn();
const enrolledFactorsMock = vi.fn(
  () => [] as Array<{ uid: string; displayName: string | null; factorId: string }>,
);
const recaptchaClearMock = vi.fn();
function RecaptchaVerifierStub(this: { clear: typeof recaptchaClearMock }) {
  this.clear = recaptchaClearMock;
}
function PhoneAuthProviderStub(this: { verifyPhoneNumber: typeof verifyPhoneNumberMock }) {
  this.verifyPhoneNumber = verifyPhoneNumberMock;
}
const phoneCredentialMock = vi.fn(() => ({ kind: 'cred' }));
const phoneAssertionMock = vi.fn(() => ({ kind: 'assertion' }));
const getMultiFactorResolverMock = vi.fn();

vi.mock('firebase/auth', () => ({
  multiFactor: vi.fn(() => ({
    getSession: getSessionMock,
    enroll: enrollMock,
    unenroll: unenrollMock,
    get enrolledFactors() {
      return enrolledFactorsMock();
    },
  })),
  PhoneAuthProvider: Object.assign(PhoneAuthProviderStub, {
    credential: phoneCredentialMock,
  }),
  PhoneMultiFactorGenerator: {
    FACTOR_ID: 'phone',
    assertion: phoneAssertionMock,
  },
  RecaptchaVerifier: RecaptchaVerifierStub,
  getMultiFactorResolver: getMultiFactorResolverMock,
}));

const {
  enrollPhoneAsSecondFactor,
  listEnrolledSecondFactors,
  resolveMultiFactorSignIn,
  unenrollSecondFactor,
} = await import('./two-factor.js');

function makeAuth(currentUser: { uid: string } | null = { uid: 'u1' }): Auth {
  return { currentUser } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  enrolledFactorsMock.mockReturnValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('enrollPhoneAsSecondFactor', () => {
  const baseOpts = {
    phoneE164: '+56912345678',
    recaptchaContainerId: 'recaptcha-x',
    promptSmsCode: vi.fn(async () => '123456'),
  };

  it('no_user → ok:false reason no_user', async () => {
    const r = await enrollPhoneAsSecondFactor({ auth: makeAuth(null), ...baseOpts });
    expect(r).toEqual({ ok: false, reason: 'no_user' });
  });

  it('phone con formato inválido → reason phone_invalid', async () => {
    const r = await enrollPhoneAsSecondFactor({
      auth: makeAuth(),
      ...baseOpts,
      phoneE164: 'no-es-phone',
    });
    expect(r).toEqual({ ok: false, reason: 'phone_invalid' });
  });

  it('happy path: getSession + verifyPhoneNumber + enroll → ok:true', async () => {
    getSessionMock.mockResolvedValueOnce({ session: 'sess' });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');
    enrollMock.mockResolvedValueOnce(undefined);

    const r = await enrollPhoneAsSecondFactor({ auth: makeAuth(), ...baseOpts });
    expect(r).toEqual({ ok: true });
    expect(phoneCredentialMock).toHaveBeenCalledWith('verif-id', '123456');
    expect(enrollMock).toHaveBeenCalled();
    expect(recaptchaClearMock).toHaveBeenCalled();
  });

  it('user cancela el SMS prompt → reason sms_cancelled', async () => {
    getSessionMock.mockResolvedValueOnce({ session: 'sess' });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');
    const opts = { ...baseOpts, promptSmsCode: vi.fn(async () => null) };
    const r = await enrollPhoneAsSecondFactor({ auth: makeAuth(), ...opts });
    expect(r).toEqual({ ok: false, reason: 'sms_cancelled' });
    expect(enrollMock).not.toHaveBeenCalled();
    expect(recaptchaClearMock).toHaveBeenCalled();
  });

  it('Firebase devuelve auth/invalid-verification-code → reason sms_invalid', async () => {
    getSessionMock.mockResolvedValueOnce({ session: 'sess' });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');
    enrollMock.mockRejectedValueOnce(
      Object.assign(new Error('bad code'), { code: 'auth/invalid-verification-code' }),
    );
    const r = await enrollPhoneAsSecondFactor({ auth: makeAuth(), ...baseOpts });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('sms_invalid');
      expect(r.detail).toContain('bad code');
    }
  });

  it('error genérico (network) → reason unknown con detail', async () => {
    getSessionMock.mockRejectedValueOnce(new Error('network down'));
    const r = await enrollPhoneAsSecondFactor({ auth: makeAuth(), ...baseOpts });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown');
      expect(r.detail).toContain('network down');
    }
  });
});

describe('listEnrolledSecondFactors', () => {
  it('sin user → []', () => {
    expect(listEnrolledSecondFactors({ auth: makeAuth(null) })).toEqual([]);
  });

  it('con factors → mapea uid/displayName/factorId', () => {
    enrolledFactorsMock.mockReturnValueOnce([
      { uid: 'f1', displayName: 'SMS +569****', factorId: 'phone' },
      { uid: 'f2', displayName: null, factorId: 'totp' },
    ]);
    const result = listEnrolledSecondFactors({ auth: makeAuth() });
    expect(result).toEqual([
      { uid: 'f1', displayName: 'SMS +569****', factorId: 'phone' },
      { uid: 'f2', displayName: null, factorId: 'totp' },
    ]);
  });
});

describe('unenrollSecondFactor', () => {
  it('sin user → ok:false', async () => {
    const r = await unenrollSecondFactor({ auth: makeAuth(null), factorUid: 'f1' });
    expect(r).toEqual({ ok: false });
  });

  it('happy → ok:true + multiFactor.unenroll llamado', async () => {
    unenrollMock.mockResolvedValueOnce(undefined);
    const r = await unenrollSecondFactor({ auth: makeAuth(), factorUid: 'f1' });
    expect(r).toEqual({ ok: true });
    expect(unenrollMock).toHaveBeenCalledWith('f1');
  });

  it('Firebase falla → ok:false', async () => {
    unenrollMock.mockRejectedValueOnce(new Error('not found'));
    const r = await unenrollSecondFactor({ auth: makeAuth(), factorUid: 'f1' });
    expect(r).toEqual({ ok: false });
  });
});

describe('resolveMultiFactorSignIn', () => {
  const opts = {
    recaptchaContainerId: 'rc',
    promptSmsCode: vi.fn(async () => '654321'),
  };
  const fakeError = {} as MultiFactorError;

  it('sin phone factor en hints → reason no_phone_factor', async () => {
    getMultiFactorResolverMock.mockReturnValueOnce({
      hints: [{ factorId: 'totp' }],
      session: { session: 's' },
      resolveSignIn: vi.fn(),
    });
    const r = await resolveMultiFactorSignIn({ auth: makeAuth(), error: fakeError, ...opts });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('no_phone_factor');
    }
  });

  it('happy path → ok:true', async () => {
    const resolveSignIn = vi.fn(async () => undefined);
    getMultiFactorResolverMock.mockReturnValueOnce({
      hints: [{ factorId: 'phone' }],
      session: { session: 's' },
      resolveSignIn,
    });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');

    const r = await resolveMultiFactorSignIn({ auth: makeAuth(), error: fakeError, ...opts });
    expect(r).toEqual({ ok: true });
    expect(resolveSignIn).toHaveBeenCalled();
  });

  it('user cancela → reason sms_cancelled', async () => {
    getMultiFactorResolverMock.mockReturnValueOnce({
      hints: [{ factorId: 'phone' }],
      session: { session: 's' },
      resolveSignIn: vi.fn(),
    });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');
    const r = await resolveMultiFactorSignIn({
      auth: makeAuth(),
      error: fakeError,
      ...opts,
      promptSmsCode: vi.fn(async () => null),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('sms_cancelled');
    }
  });

  it('Firebase devuelve auth/invalid-verification-code → reason sms_invalid', async () => {
    const resolveSignIn = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('bad'), { code: 'auth/invalid-verification-code' }),
      );
    getMultiFactorResolverMock.mockReturnValueOnce({
      hints: [{ factorId: 'phone' }],
      session: { session: 's' },
      resolveSignIn,
    });
    verifyPhoneNumberMock.mockResolvedValueOnce('verif-id');

    const r = await resolveMultiFactorSignIn({ auth: makeAuth(), error: fakeError, ...opts });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('sms_invalid');
    }
  });

  it('error genérico → reason unknown', async () => {
    getMultiFactorResolverMock.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const r = await resolveMultiFactorSignIn({ auth: makeAuth(), error: fakeError, ...opts });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('unknown');
    }
  });
});
