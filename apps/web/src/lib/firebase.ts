import { type FirebaseApp, initializeApp } from 'firebase/app';
import {
  type Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import { env } from './env.js';

/**
 * Firebase client SDK init. Singleton por proceso (Vite HMR puede re-ejecutar
 * el módulo, pero `initializeApp` es idempotente cuando ya existe).
 *
 * Persistence local — el user queda logueado entre tabs y reloads. Para
 * logout explícito usar `firebaseAuth.signOut()` desde useAuth().
 */
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  ...(env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
  ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID
    ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID }
    : {}),
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth: Auth = getAuth(firebaseApp);

// Persistencia local (default browser) — sobrevive cierres de tab.
void setPersistence(firebaseAuth, browserLocalPersistence);

/**
 * Provider Google para sign-in con popup. Pre-configurado con scopes default
 * (email + profile). Si necesitamos más scopes (Drive, Calendar) agregar
 * aquí: `googleProvider.addScope('https://www.googleapis.com/auth/drive.readonly')`.
 */
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account', // forzar selector de cuenta cuando hay múltiples
});
