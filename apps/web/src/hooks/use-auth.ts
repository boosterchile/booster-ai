import {
  type User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { useEffect, useState } from 'react';
import { firebaseAuth, googleProvider } from '../lib/firebase.js';

export interface AuthState {
  /** Firebase user actual. null si no logueado. undefined mientras carga el primer estado. */
  user: User | null | undefined;
  /** True mientras Firebase resuelve el primer estado de auth (post-mount). */
  loading: boolean;
}

/**
 * Hook de estado de auth Firebase. Suscribe a `onAuthStateChanged` y
 * mantiene `user` reactivo. La primera resolución es asíncrona; mientras
 * tanto `loading=true` y `user=undefined`. Una vez resuelto, `loading=false`
 * y `user` es `null` (no logueado) o `User` (logueado).
 *
 * El token Firebase se refresca automáticamente; el cliente HTTP lo lee
 * con `getIdToken()` en cada request.
 */
export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      setUser(next);
      setLoading(false);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return { user, loading };
}

/**
 * Inicia el flow de Google sign-in con popup. Devuelve el User cuando se
 * completa, o lanza si el user cancela / falla la auth.
 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(firebaseAuth, googleProvider);
  return result.user;
}

/**
 * Login email + password. Lanza FirebaseError si las credenciales son
 * inválidas (auth/invalid-credential), user no existe (auth/user-not-found,
 * auth/wrong-password) o el user fue desactivado (auth/user-disabled).
 */
export async function signInWithEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(firebaseAuth, email, password);
  return result.user;
}

/**
 * Registro nuevo con email + password. Setea displayName si se provee.
 *
 * Lanza FirebaseError si el email ya existe (auth/email-already-in-use),
 * password débil (auth/weak-password, < 6 chars), o email inválido
 * (auth/invalid-email).
 *
 * Tras success, el user queda logueado automáticamente y dispara el
 * onAuthStateChanged → useAuth().user pasa de null a User.
 */
export async function signUpWithEmail(opts: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<User> {
  const result = await createUserWithEmailAndPassword(firebaseAuth, opts.email, opts.password);
  if (opts.displayName) {
    await updateProfile(result.user, { displayName: opts.displayName });
  }
  return result.user;
}

/**
 * Enviar email para resetear password. Firebase manda el link al inbox.
 * Lanza si el email no está registrado (auth/user-not-found) o inválido.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth, email);
}

/**
 * Logout. Borra el token y dispara onAuthStateChanged → useAuth pasa a
 * `user=null`. El consumer típicamente redirige a /login.
 */
export async function signOutUser(): Promise<void> {
  await signOut(firebaseAuth);
}
