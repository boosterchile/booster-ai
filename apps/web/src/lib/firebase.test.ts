import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeAppMock = vi.fn(() => ({ name: '[DEFAULT]' }));
const getAuthMock = vi.fn(() => ({ name: 'auth' }));
const setPersistenceMock = vi.fn(async () => undefined);
const connectAuthEmulatorMock = vi.fn();
const browserLocalPersistenceMock = { type: 'LOCAL' };
const setCustomParametersMock = vi.fn();
function GoogleAuthProviderStub(this: { setCustomParameters: typeof setCustomParametersMock }) {
  this.setCustomParameters = setCustomParametersMock;
}
// Firmas tipadas para que `mock.calls[0]` se infiera sin `as unknown as`
// (CLAUDE.md prohíbe el doble cast). El valor de retorno es irrelevante para
// los asserts; solo importan los argumentos con los que se invoca.
const initializeAppCheckMock = vi.fn(
  (_app: unknown, _options: { provider: unknown; isTokenAutoRefreshEnabled: boolean }) => ({
    name: 'app-check',
  }),
);
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
  connectAuthEmulator: connectAuthEmulatorMock,
  browserLocalPersistence: browserLocalPersistenceMock,
  GoogleAuthProvider: GoogleAuthProviderStub,
}));

beforeEach(() => {
  vi.resetModules();
  initializeAppMock.mockClear();
  getAuthMock.mockClear();
  setPersistenceMock.mockClear();
  connectAuthEmulatorMock.mockClear();
  setCustomParametersMock.mockClear();
  initializeAppCheckMock.mockClear();
  reCaptchaV3ProviderMock.mockClear();
  // Reset del flag global entre tests (lo setea el bloque DEV de firebase.ts).
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = undefined;
  vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'false');
  vi.stubEnv('VITE_AUTH_EMULATOR_URL', '');
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
    expect(initializeAppCheckMock).toHaveBeenCalledWith(
      mod.firebaseApp,
      expect.objectContaining({ isTokenAutoRefreshEnabled: true }),
    );
    const options = initializeAppCheckMock.mock.calls.at(0)?.[1];
    expect(options?.provider).toBeInstanceOf(ReCaptchaV3ProviderStub);
    expect(reCaptchaV3ProviderMock).toHaveBeenCalledWith('test-recaptcha-site-key');
  });

  it('inicializa App Check ANTES que getAuth', async () => {
    await import('./firebase.js');
    const appCheckOrder = initializeAppCheckMock.mock.invocationCallOrder.at(0) ?? Number.NaN;
    const getAuthOrder = getAuthMock.mock.invocationCallOrder.at(0) ?? Number.NaN;
    expect(appCheckOrder).toBeLessThan(getAuthOrder);
  });

  // Invariante de seguridad (spec §3/§6.3): el debug token SOLO se activa en
  // desarrollo. En prod `import.meta.env.DEV` es false y el bloque se elimina
  // por tree-shaking; acá probamos el condicional a nivel de fuente (el DCE es
  // a build-time, se verifica aparte grepeando el bundle).
  it('NO setea FIREBASE_APPCHECK_DEBUG_TOKEN cuando no es DEV (prod)', async () => {
    vi.stubEnv('DEV', false);
    await import('./firebase.js');
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    vi.stubEnv('DEV', true); // restaurar default sin tocar los stubs VITE_* de setup.ts
  });

  it('SÍ setea FIREBASE_APPCHECK_DEBUG_TOKEN en DEV', async () => {
    vi.stubEnv('DEV', true);
    await import('./firebase.js');
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });

  it('flag OFF: no llama connectAuthEmulator y sí inicializa App Check', async () => {
    vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'false');
    await import('./firebase.js');
    expect(connectAuthEmulatorMock).not.toHaveBeenCalled();
    expect(initializeAppCheckMock).toHaveBeenCalledTimes(1);
  });

  it('flag ON: connectAuthEmulator a 127.0.0.1:9099 y NO inicializa App Check', async () => {
    vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'true');
    await import('./firebase.js');
    expect(connectAuthEmulatorMock).toHaveBeenCalledTimes(1);
    expect(connectAuthEmulatorMock).toHaveBeenCalledWith(
      expect.anything(),
      'http://127.0.0.1:9099',
      expect.objectContaining({ disableWarnings: true }),
    );
    expect(initializeAppCheckMock).not.toHaveBeenCalled();
    expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    const mod = await import('./firebase.js');
    expect(mod.appCheck).toBeNull();
  });

  it('flag ON con host no-loopback: throw (nunca Identity Platform)', async () => {
    vi.stubEnv('VITE_USE_AUTH_EMULATOR', 'true');
    vi.stubEnv('VITE_AUTH_EMULATOR_URL', 'https://identitytoolkit.googleapis.com');
    await expect(import('./firebase.js')).rejects.toThrow(/loopback|Identity Platform/i);
    expect(connectAuthEmulatorMock).not.toHaveBeenCalled();
  });
});
