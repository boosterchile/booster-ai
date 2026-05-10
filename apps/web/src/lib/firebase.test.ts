import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeAppMock = vi.fn(() => ({ name: '[DEFAULT]' }));
const getAuthMock = vi.fn(() => ({ name: 'auth' }));
const setPersistenceMock = vi.fn(async () => undefined);
const browserLocalPersistenceMock = { type: 'LOCAL' };
const setCustomParametersMock = vi.fn();
function GoogleAuthProviderStub(this: { setCustomParameters: typeof setCustomParametersMock }) {
  this.setCustomParameters = setCustomParametersMock;
}

vi.mock('firebase/app', () => ({
  initializeApp: initializeAppMock,
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
});
