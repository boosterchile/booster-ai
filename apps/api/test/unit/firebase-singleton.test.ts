import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initializeAppMock = vi.fn(() => ({ name: 'app-instance' }));
const getAppsMock = vi.fn(() => [] as unknown[]);
const applicationDefaultMock = vi.fn(() => ({}));
const getAuthMock = vi.fn(() => ({ name: 'auth-instance' }));

vi.mock('firebase-admin/app', () => ({
  initializeApp: initializeAppMock,
  getApps: getAppsMock,
  applicationDefault: applicationDefaultMock,
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: getAuthMock,
}));

const { _resetFirebaseSingletonsForTests, getFirebaseApp, getFirebaseAuth } = await import(
  '../../src/services/firebase.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  _resetFirebaseSingletonsForTests();
  getAppsMock.mockReturnValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('getFirebaseApp', () => {
  it('primer call: invoca initializeApp con applicationDefault + projectId', () => {
    const app = getFirebaseApp({ projectId: 'booster-ai-test' });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
    expect(initializeAppMock).toHaveBeenCalledWith({
      credential: expect.anything(),
      projectId: 'booster-ai-test',
    });
    expect(app).toEqual({ name: 'app-instance' });
  });

  it('segundo call: retorna cached app sin re-init', () => {
    getFirebaseApp({ projectId: 'booster-ai-test' });
    getFirebaseApp({ projectId: 'booster-ai-test' });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);
  });

  it('si getApps() ya retorna app existente (firebase-admin pre-inicializado), reusa la primera', () => {
    const existing = { name: 'existing-app' };
    getAppsMock.mockReturnValueOnce([existing]).mockReturnValueOnce([existing]);
    const app = getFirebaseApp({ projectId: 'p' });
    expect(initializeAppMock).not.toHaveBeenCalled();
    expect(app).toBe(existing);
  });
});

describe('getFirebaseAuth', () => {
  it('primer call: invoca getAuth con la app inicializada', () => {
    const auth = getFirebaseAuth({ projectId: 'p' });
    expect(getAuthMock).toHaveBeenCalledTimes(1);
    expect(auth).toEqual({ name: 'auth-instance' });
  });

  it('segundo call: retorna cached auth sin re-invocar getAuth', () => {
    getFirebaseAuth({ projectId: 'p' });
    getFirebaseAuth({ projectId: 'p' });
    expect(getAuthMock).toHaveBeenCalledTimes(1);
  });
});

describe('_resetFirebaseSingletonsForTests', () => {
  it('resetea cache: próxima call re-invoca initializeApp', () => {
    getFirebaseApp({ projectId: 'p' });
    expect(initializeAppMock).toHaveBeenCalledTimes(1);

    _resetFirebaseSingletonsForTests();
    getFirebaseApp({ projectId: 'p' });
    expect(initializeAppMock).toHaveBeenCalledTimes(2);
  });
});
