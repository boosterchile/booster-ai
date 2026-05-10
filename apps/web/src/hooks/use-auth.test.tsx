import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks de firebase/auth — interceptamos todo el módulo.
const onAuthStateChangedMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signInWithEmailAndPasswordMock = vi.fn();
const createUserWithEmailAndPasswordMock = vi.fn();
const sendPasswordResetEmailMock = vi.fn();
const signOutMock = vi.fn();
const linkWithPopupMock = vi.fn();
const linkWithCredentialMock = vi.fn();
const unlinkMock = vi.fn();
const reauthenticateWithPopupMock = vi.fn();
const reauthenticateWithCredentialMock = vi.fn();
const updatePasswordMock = vi.fn();
const updateProfileMock = vi.fn();
const credentialMock = vi.fn(() => ({ providerId: 'password' }));

vi.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: credentialMock },
  onAuthStateChanged: onAuthStateChangedMock,
  signInWithPopup: signInWithPopupMock,
  signInWithEmailAndPassword: signInWithEmailAndPasswordMock,
  createUserWithEmailAndPassword: createUserWithEmailAndPasswordMock,
  sendPasswordResetEmail: sendPasswordResetEmailMock,
  signOut: signOutMock,
  linkWithPopup: linkWithPopupMock,
  linkWithCredential: linkWithCredentialMock,
  unlink: unlinkMock,
  reauthenticateWithPopup: reauthenticateWithPopupMock,
  reauthenticateWithCredential: reauthenticateWithCredentialMock,
  updatePassword: updatePasswordMock,
  updateProfile: updateProfileMock,
}));

vi.mock('../lib/firebase.js', () => ({
  firebaseAuth: { currentUser: null },
  googleProvider: {},
}));

const {
  getLinkedProviders,
  linkGoogleProvider,
  linkPasswordProvider,
  reauthCurrent,
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  signUpWithEmail,
  unlinkProvider,
  updatePasswordCurrent,
  useAuth,
} = await import('./use-auth.js');
const { setActiveEmpresaId, getActiveEmpresaId } = await import('../lib/api-client.js');

function makeWrapper() {
  const client = new QueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAuth', () => {
  it('al mount: loading=true, user=undefined', () => {
    onAuthStateChangedMock.mockImplementation(() => () => undefined);
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeUndefined();
  });

  it('cuando onAuthStateChanged emite null → loading=false, user=null', async () => {
    let callback: (user: unknown) => void = () => undefined;
    onAuthStateChangedMock.mockImplementation((_auth, cb) => {
      callback = cb;
      return () => undefined;
    });
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    await act(async () => {
      callback(null);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('cuando onAuthStateChanged emite user → loading=false, user setado', async () => {
    let callback: (user: unknown) => void = () => undefined;
    onAuthStateChangedMock.mockImplementation((_auth, cb) => {
      callback = cb;
      return () => undefined;
    });
    const { result } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    await act(async () => {
      callback({ uid: 'uid-1', email: 'a@b.c' });
    });
    expect(result.current.loading).toBe(false);
    expect((result.current.user as { uid: string }).uid).toBe('uid-1');
  });

  it('unsubscribe se llama al unmount', () => {
    const unsubscribe = vi.fn();
    onAuthStateChangedMock.mockImplementation(() => unsubscribe);
    const { unmount } = renderHook(() => useAuth(), { wrapper: makeWrapper() });
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('signIn helpers', () => {
  it('signInWithGoogle delega en signInWithPopup', async () => {
    signInWithPopupMock.mockResolvedValueOnce({ user: { uid: 'g-1' } });
    const user = await signInWithGoogle();
    expect((user as { uid: string }).uid).toBe('g-1');
  });

  it('signInWithEmail', async () => {
    signInWithEmailAndPasswordMock.mockResolvedValueOnce({ user: { uid: 'e-1' } });
    const user = await signInWithEmail('a@b.c', 'pass');
    expect((user as { uid: string }).uid).toBe('e-1');
  });

  it('signUpWithEmail con displayName actualiza profile', async () => {
    createUserWithEmailAndPasswordMock.mockResolvedValueOnce({
      user: { uid: 'new-1' },
    });
    await signUpWithEmail({ email: 'a@b.c', password: 'pass', displayName: 'Felipe' });
    expect(updateProfileMock).toHaveBeenCalledWith({ uid: 'new-1' }, { displayName: 'Felipe' });
  });

  it('signUpWithEmail sin displayName NO llama updateProfile', async () => {
    createUserWithEmailAndPasswordMock.mockResolvedValueOnce({ user: { uid: 'new-2' } });
    await signUpWithEmail({ email: 'a@b.c', password: 'pass' });
    expect(updateProfileMock).not.toHaveBeenCalled();
  });

  it('requestPasswordReset', async () => {
    sendPasswordResetEmailMock.mockResolvedValueOnce(undefined);
    await requestPasswordReset('a@b.c');
    expect(sendPasswordResetEmailMock).toHaveBeenCalled();
  });

  it('signOutUser limpia activeEmpresaId + signOut', async () => {
    setActiveEmpresaId('emp-x');
    signOutMock.mockResolvedValueOnce(undefined);
    await signOutUser();
    expect(getActiveEmpresaId()).toBeNull();
    expect(signOutMock).toHaveBeenCalled();
  });
});

describe('account linking', () => {
  const fakeUser = {
    uid: 'u',
    providerData: [{ providerId: 'google.com' }, { providerId: 'password' }],
  } as never;

  it('getLinkedProviders devuelve google + password', () => {
    expect(getLinkedProviders(fakeUser)).toEqual(['google.com', 'password']);
  });

  it('getLinkedProviders ignora providers desconocidos', () => {
    const u = {
      uid: 'u',
      providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }],
    } as never;
    expect(getLinkedProviders(u)).toEqual(['google.com']);
  });

  it('linkGoogleProvider', async () => {
    linkWithPopupMock.mockResolvedValueOnce({ user: fakeUser });
    const user = await linkGoogleProvider(fakeUser);
    expect((user as { uid: string }).uid).toBe('u');
  });

  it('linkPasswordProvider', async () => {
    linkWithCredentialMock.mockResolvedValueOnce({ user: fakeUser });
    await linkPasswordProvider(fakeUser, 'a@b.c', 'pass');
    expect(credentialMock).toHaveBeenCalledWith('a@b.c', 'pass');
    expect(linkWithCredentialMock).toHaveBeenCalled();
  });

  it('unlinkProvider', async () => {
    unlinkMock.mockResolvedValueOnce(fakeUser);
    await unlinkProvider(fakeUser, 'google.com');
    expect(unlinkMock).toHaveBeenCalledWith(fakeUser, 'google.com');
  });

  it('reauthCurrent google', async () => {
    reauthenticateWithPopupMock.mockResolvedValueOnce(undefined);
    await reauthCurrent(fakeUser, { type: 'google' });
    expect(reauthenticateWithPopupMock).toHaveBeenCalled();
  });

  it('reauthCurrent password', async () => {
    reauthenticateWithCredentialMock.mockResolvedValueOnce(undefined);
    await reauthCurrent(fakeUser, { type: 'password', email: 'a@b.c', password: 'p' });
    expect(credentialMock).toHaveBeenCalledWith('a@b.c', 'p');
    expect(reauthenticateWithCredentialMock).toHaveBeenCalled();
  });

  it('updatePasswordCurrent', async () => {
    updatePasswordMock.mockResolvedValueOnce(undefined);
    await updatePasswordCurrent(fakeUser, 'newpass');
    expect(updatePasswordMock).toHaveBeenCalledWith(fakeUser, 'newpass');
  });
});
