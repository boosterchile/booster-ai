import { type FirebaseApp, initializeApp } from 'firebase/app';
import { type AppCheck, ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check';
import {
  type Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from 'firebase/auth';
import { env } from './env.js';

declare global {
  interface Window {
    /**
     * Flag de Firebase App Check para emitir un debug token en entornos sin
     * reCAPTCHA real (desarrollo/local). Solo se setea bajo `import.meta.env.DEV`.
     */
    FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string | undefined;
  }
}

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

// App Check debe inicializarse INMEDIATAMENTE después de `initializeApp` y
// ANTES de cualquier otro servicio Firebase (auth, firestore, storage…) para
// que sus requests lleven el token de attestation reCAPTCHA v3.
//
// Debug token: solo en desarrollo. `import.meta.env.DEV` es `true` en `vite dev`
// y en tests, y se reemplaza estáticamente por `false` en `vite build` — el
// bloque queda como `if (false)` y desaparece del bundle por tree-shaking, así
// que NUNCA se activa en producción.
//
// La primera carga en local imprime un debug token en la consola del navegador.
// Hay que copiarlo y registrarlo manualmente en:
//   Firebase Console → App Check → Apps → (web app) → Manage debug tokens.
// Sin ese registro, App Check rechaza las requests del entorno local.
if (import.meta.env.DEV) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

export const appCheck: AppCheck = initializeAppCheck(firebaseApp, {
  provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
  // Nombre real de la opción en el SDK Firebase v12 (la doc/uso coloquial la
  // llama "isTokenAutoRefresh"): refresca el token de App Check en background.
  isTokenAutoRefreshEnabled: true,
});

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
