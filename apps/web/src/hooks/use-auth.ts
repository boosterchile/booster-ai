import { type User, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
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
 * Logout. Borra el token y dispara onAuthStateChanged → useAuth pasa a
 * `user=null`. El consumer típicamente redirige a /login.
 */
export async function signOutUser(): Promise<void> {
  await signOut(firebaseAuth);
}
