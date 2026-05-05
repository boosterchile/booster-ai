import { useQueryClient } from '@tanstack/react-query';
import {
  EmailAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  unlink,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { setActiveEmpresaId } from '../lib/api-client.js';
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
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // Track del uid previo para detectar cambios de user (incluyendo logout).
  // Inicializado en `undefined` distinto al primer onAuthStateChanged que
  // siempre dispara con el estado actual — la primera resolución NO debe
  // invalidar (no hay user anterior real, solo es el bootstrap).
  const previousUidRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      const previousUid = previousUidRef.current;
      const newUid = next?.uid ?? null;
      // Si el uid cambió (logout, login con otro user, account linking que
      // emite uid distinto), invalidar TODO el cache de TanStack Query.
      // Sin esto, el nuevo user ve data del anterior (useMe, useVehicles,
      // useOffers, etc.) hasta que cada query refetchee — riesgo de
      // confidencialidad cross-tenant.
      //
      // Casos cubiertos:
      //   - logout (newUid = null)
      //   - login con otro user después de logout
      //   - cambio de uid por account linking (firebase_uid se actualiza)
      // Excluido: bootstrap inicial (previousUid === undefined → no clear).
      if (previousUid !== undefined && previousUid !== newUid) {
        queryClient.clear();
      }
      previousUidRef.current = newUid;
      setUser(next);
      setLoading(false);
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);

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
 * Enviar email para resetear password. Firebase manda el enlace al inbox.
 * Lanza si el email no está registrado (auth/user-not-found) o inválido.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(firebaseAuth, email);
}

/**
 * Logout. Borra el token y dispara onAuthStateChanged → useAuth pasa a
 * `user=null`. El consumer típicamente redirige a /login.
 *
 * Limpia también `activeEmpresaId` de localStorage. Sin esto, si user A
 * deja una empresa activa X y user B se loguea después, B mandaría el
 * X-Empresa-Id de A al backend → /me devolvería null o (con fallback
 * activado) la primera empresa de B con un mismatch silencioso.
 */
export async function signOutUser(): Promise<void> {
  setActiveEmpresaId(null);
  await signOut(firebaseAuth);
}

// =============================================================================
// Account linking — agregar/quitar providers de auth de la cuenta actual
// =============================================================================

export type ProviderId = 'google.com' | 'password';

export function getLinkedProviders(user: User): ProviderId[] {
  return user.providerData
    .map((p) => p.providerId)
    .filter((id): id is ProviderId => id === 'google.com' || id === 'password');
}

/**
 * Vincula la cuenta Google al user actual. Abre popup de selección de
 * cuenta. Lanza:
 *   - 'auth/credential-already-in-use': la cuenta Google ya pertenece a
 *     otro user de Firebase (NO es nuestro user). El caller debe ofrecer
 *     opciones (logout y loguearse con esa Google, o cancelar).
 *   - 'auth/provider-already-linked': el user ya tiene Google linkeado.
 *   - 'auth/popup-closed-by-user': user canceló.
 */
export async function linkGoogleProvider(user: User): Promise<User> {
  const result = await linkWithPopup(user, googleProvider);
  return result.user;
}

/**
 * Vincula email+password al user actual. El email debe ser distinto al
 * que ya tiene (sino password override sin sentido). Recomendación UX:
 * pre-llenar email = user.email para que sea trivial.
 *
 * Lanza:
 *   - 'auth/email-already-in-use': otro user ya tiene email/password con ese email.
 *   - 'auth/provider-already-linked': el user ya tiene password linkeado.
 *   - 'auth/weak-password': < 6 chars.
 *   - 'auth/requires-recent-login': el user necesita re-autenticarse antes
 *     (Firebase exige que la auth original sea reciente, < 5 min, para
 *     operaciones sensibles). El caller debe llamar a `reauthCurrent()`.
 */
export async function linkPasswordProvider(
  user: User,
  email: string,
  password: string,
): Promise<User> {
  const credential = EmailAuthProvider.credential(email, password);
  const result = await linkWithCredential(user, credential);
  return result.user;
}

/**
 * Desvincula un provider del user. Solo permitido si quedará al menos
 * 1 provider después (Firebase rechaza si vas a quedar sin auth).
 */
export async function unlinkProvider(user: User, providerId: ProviderId): Promise<User> {
  return unlink(user, providerId);
}

/**
 * Re-autenticar al user actual. Necesario antes de operaciones
 * sensibles si la sesión es vieja. El caller pasa qué método usar según
 * los providers que el user tiene.
 */
export async function reauthCurrent(
  user: User,
  method: { type: 'google' } | { type: 'password'; email: string; password: string },
): Promise<void> {
  if (method.type === 'google') {
    await reauthenticateWithPopup(user, googleProvider);
  } else {
    const credential = EmailAuthProvider.credential(method.email, method.password);
    await reauthenticateWithCredential(user, credential);
  }
}

/**
 * Cambia la contraseña del user actual. Requiere que el provider
 * 'password' esté linkeado (Firebase rechaza con 'auth/no-such-provider'
 * si solo está Google) y que la sesión sea reciente — el caller debe
 * llamar a `reauthCurrent()` antes con la contraseña actual.
 *
 * Errores Firebase relevantes:
 *   - 'auth/weak-password':           el caller validó mal antes (la
 *                                     política Booster es 8+ chars).
 *   - 'auth/requires-recent-login':   reauth fue hace > 5 min; reintentar
 *                                     llamando a reauthCurrent primero.
 */
export async function updatePasswordCurrent(user: User, newPassword: string): Promise<void> {
  await updatePassword(user, newPassword);
}
