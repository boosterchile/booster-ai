import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeAppMock = vi.fn(() => ({ name: '[DEFAULT]' }));
const getAuthMock = vi.fn(() => ({ name: 'auth' }));
const setPersistenceMock = vi.fn(async () => undefined);
const browserLocalPersistenceMock = { type: 'LOCAL' };
const setCustomParametersMock = vi.fn();
function GoogleAuthProviderStub(this: { setCustomParameters: typeof setCustomParametersMock }) {
  this.setCustomParameters = setCustomParametersMock;
}
const initializeAppCheckMock = vi.fn(() => ({ name: 'app-check' }));
const reCaptchaV3ProviderMock = vi.fn();
function ReCaptchaV3ProviderStub(this: Record<string, never>, siteKey: string) {
  reCaptchaV3ProviderMock(siteKey);
}

vi.mock('firebase/app', () => ({
  initializeApp: initializeAppMock,
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: initializeAppCheckMock,
  ReCaptchaV3Provider: ReCaptchaV3ProviderStub,
}));

vi.mock('firebase/auth', () => ({
  getAuth: getAuthMock,
  setPersistence: setPersistenceMock,
  browserLocalPersistence: browserLocalPersistenceMock,
  GoogleAuthProvider: GoogleAuthProviderStub,
}));

beforeEach(() => {
  vi.resetModules();
  initializeAppMock.mockClear();
  getAuthMock.mockClear();
  setPersistenceMock.mockClear();
  setCustomParametersMock.mockClear();
  initializeAppCheckMock.mockClear();
  reCaptchaV3ProviderMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('lib/firebase', () => {
  it('inicializa Firebase con la config VITE_FIREBASE_*', async () => {
    await import('./firebase.js');
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
    const config = (initializeAppMock.mock.calls[0] as unknown as [Record<string, string>])?.[0];
    expect(config).toMatchObject({
      apiKey: expect.any(String),
      authDomain: expect.any(String),
      projectId: expect.any(String),
      appId: expect.any(String),
    });
  });

  it('exporta firebaseApp y firebaseAuth', async () => {
    const mod = await import('./firebase.js');
    expect(mod.firebaseApp).toBeDefined();
    expect(mod.firebaseAuth).toBeDefined();
    expect(getAuthMock).toHaveBeenCalledWith(mod.firebaseApp);
  });

  it('aplica browserLocalPersistence al auth', async () => {
    await import('./firebase.js');
    expect(setPersistenceMock).toHaveBeenCalledWith(expect.anything(), browserLocalPersistenceMock);
  });

  it('crea GoogleAuthProvider con setCustomParameters', async () => {
    const mod = await import('./firebase.js');
    expect(mod.googleProvider).toBeDefined();
    expect(setCustomParametersMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'select_account' }),
    );
  });

  it('inicializa App Check con ReCaptchaV3Provider e isTokenAutoRefresh', async () => {
    const mod = await import('./firebase.js');
    expect(mod.appCheck).toBeDefined();
    expect(initializeAppCheckMock).toHaveBeenCalledTimes(1);
    const [app, options] = initializeAppCheckMock.mock.calls[0] as unknown as [
      unknown,
      { provider: unknown; isTokenAutoRefreshEnabled: boolean },
    ];
    expect(app).toBe(mod.firebaseApp);
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
    expect(options.provider).toBeInstanceOf(ReCaptchaV3ProviderStub);
    expect(reCaptchaV3ProviderMock).toHaveBeenCalledWith('test-recaptcha-site-key');
  });

  it('inicializa App Check ANTES que getAuth', async () => {
    await import('./firebase.js');
    const appCheckOrder = initializeAppCheckMock.mock.invocationCallOrder.at(0) ?? Number.NaN;
    const getAuthOrder = getAuthMock.mock.invocationCallOrder.at(0) ?? Number.NaN;
    expect(appCheckOrder).toBeLessThan(getAuthOrder);
  });
});
