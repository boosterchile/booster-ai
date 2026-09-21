import { type App, applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';

/**
 * Firebase Admin SDK singleton.
 *
 * En Cloud Run no necesitamos archivo de credenciales: usamos Application
 * Default Credentials (ADC) — el runtime SA tiene roles/firebaseauth.admin
 * configurado en infrastructure/security.tf y eso permite verifyIdToken
 * sin keys descargadas.
 *
 * En desarrollo local: setear GOOGLE_APPLICATION_CREDENTIALS al path del
 * SA key descargado (ver runbook setup-dev).
 *
 * Auth emulator: si `FIREBASE_AUTH_EMULATOR_HOST` está seteado, se inicializa
 * sin ADC (el emulador no verifica credenciales). El Admin SDK redirige
 * Auth a ese host automáticamente.
 *
 * `initializeApp` falla si se llama dos veces. Por eso chequeamos getApps()
 * antes de inicializar.
 */
let cachedApp: App | undefined;
let cachedAuth: Auth | undefined;

export function getFirebaseApp(opts: { projectId: string }): App {
  if (cachedApp) {
    return cachedApp;
  }
  if (getApps().length > 0) {
    cachedApp = getApps()[0] as App;
    return cachedApp;
  }
  // Auth emulator (Slot 3 paso 6): FIREBASE_AUTH_EMULATOR_HOST hace que el
  // Admin SDK hable con :9099. ADC no existe en CI/local sin SA key, y el
  // emulador no la pide. Sin este branch, el boot del API en el E2E
  // moría en applicationDefault().
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    cachedApp = initializeApp({
      projectId: opts.projectId,
    });
    return cachedApp;
  }
  cachedApp = initializeApp({
    credential: applicationDefault(),
    projectId: opts.projectId,
  });
  return cachedApp;
}

export function getFirebaseAuth(opts: { projectId: string }): Auth {
  if (cachedAuth) {
    return cachedAuth;
  }
  cachedAuth = getAuth(getFirebaseApp(opts));
  return cachedAuth;
}

/**
 * Reset interno para tests. NO usar en producción.
 */
export function _resetFirebaseSingletonsForTests(): void {
  cachedApp = undefined;
  cachedAuth = undefined;
}
