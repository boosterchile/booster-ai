import { Navigate, useNavigate } from '@tanstack/react-router';
import type { FirebaseError } from 'firebase/app';
import { LogIn, Mail } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import {
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  useAuth,
} from '../hooks/use-auth.js';

type Mode = 'sign-in' | 'sign-up' | 'reset';

/**
 * /login — pantalla de autenticación con tres flows:
 *   - Google sign-in (popup)
 *   - Email + password (sign in / sign up)
 *   - Password reset (email con link de Firebase)
 *
 * Tras login exitoso → /app, que decide via /me si va a /onboarding o
 * directo al dashboard según `needs_onboarding`.
 */
export function LoginRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  if (user) {
    return <Navigate to="/app" />;
  }

  function clearMsgs() {
    setError(null);
    setResetSent(false);
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    clearMsgs();
    try {
      await signInWithGoogle();
      void navigate({ to: '/app' });
    } catch (err) {
      const code = (err as FirebaseError).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setError(translateAuthError(code) ?? 'No pudimos iniciar sesión con Google.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    clearMsgs();
    try {
      if (mode === 'sign-in') {
        await signInWithEmail(email, password);
        void navigate({ to: '/app' });
      } else if (mode === 'sign-up') {
        await signUpWithEmail({
          email,
          password,
          ...(name.trim() ? { displayName: name.trim() } : {}),
        });
        void navigate({ to: '/app' });
      } else {
        await requestPasswordReset(email);
        setResetSent(true);
      }
    } catch (err) {
      const code = (err as FirebaseError).code;
      setError(translateAuthError(code) ?? 'No pudimos completar la operación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
          <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            {mode === 'sign-up'
              ? 'Crea tu cuenta'
              : mode === 'reset'
                ? 'Recuperar acceso'
                : 'Inicia sesión'}
          </h1>
          <p className="mt-2 text-neutral-600 text-sm">
            {mode === 'sign-up'
              ? 'Después podrás crear tu empresa o unirte a una existente.'
              : mode === 'reset'
                ? 'Te enviamos un email con el enlace para crear una nueva contraseña.'
                : 'Plataforma de logística sostenible para empresas y transportistas en Chile.'}
          </p>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
            >
              {error}
            </div>
          )}

          {resetSent && (
            <output className="mt-6 block rounded-md border border-success-500/30 bg-success-50 p-3 text-sm text-success-700">
              Listo. Si {email} existe, te llegó un email con el enlace para restablecer tu
              contraseña.
            </output>
          )}

          <form onSubmit={handleEmailSubmit} className="mt-6 space-y-4">
            {mode === 'sign-up' && (
              <div>
                <label htmlFor="name" className="block font-medium text-neutral-700 text-sm">
                  Tu nombre
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  required
                  className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block font-medium text-neutral-700 text-sm">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label htmlFor="password" className="block font-medium text-neutral-700 text-sm">
                  Contraseña
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900 text-sm shadow-xs focus:border-primary-500 focus:outline-none"
                />
                {mode === 'sign-up' && (
                  <p className="mt-1 text-neutral-500 text-xs">Mínimo 6 caracteres.</p>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || loading}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-primary-500 px-4 py-3 font-medium text-sm text-white shadow-xs transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mode === 'sign-up' ? (
                <>Crear cuenta</>
              ) : mode === 'reset' ? (
                <>
                  <Mail className="h-4 w-4" aria-hidden />
                  Enviar link
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" aria-hidden />
                  {busy ? 'Conectando…' : 'Entrar'}
                </>
              )}
            </button>
          </form>

          {mode === 'sign-in' && (
            <>
              <div className="my-6 flex items-center gap-3 text-neutral-400 text-xs">
                <span className="h-px flex-1 bg-neutral-200" />o
                <span className="h-px flex-1 bg-neutral-200" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={busy || loading}
                className="flex w-full items-center justify-center gap-3 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-neutral-900 text-sm shadow-xs transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continuar con Google
              </button>
            </>
          )}

          <div className="mt-6 space-y-2 text-center text-neutral-600 text-sm">
            {mode === 'sign-in' && (
              <>
                <p>
                  ¿Sin cuenta?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('sign-up');
                      clearMsgs();
                    }}
                    className="font-medium text-primary-600 hover:underline"
                  >
                    Crea una
                  </button>
                </p>
                <p>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('reset');
                      clearMsgs();
                    }}
                    className="font-medium text-primary-600 hover:underline"
                  >
                    Olvidé mi contraseña
                  </button>
                </p>
              </>
            )}
            {mode === 'sign-up' && (
              <p>
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('sign-in');
                    clearMsgs();
                  }}
                  className="font-medium text-primary-600 hover:underline"
                >
                  Inicia sesión
                </button>
              </p>
            )}
            {mode === 'reset' && (
              <p>
                <button
                  type="button"
                  onClick={() => {
                    setMode('sign-in');
                    clearMsgs();
                  }}
                  className="font-medium text-primary-600 hover:underline"
                >
                  Volver al inicio de sesión
                </button>
              </p>
            )}
          </div>

          <p className="mt-6 text-center text-neutral-500 text-xs">
            Al continuar aceptas los términos del servicio y la política de privacidad de Booster
            AI.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Mensajes en español para los códigos de error más comunes de Firebase
 * Auth. Si el código no está mapeado, devuelve null y el caller usa un
 * fallback genérico.
 */
function translateAuthError(code: string | undefined): string | null {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Email o contraseña incorrectos.';
    case 'auth/user-not-found':
      return 'No existe una cuenta con ese email.';
    case 'auth/wrong-password':
      return 'Contraseña incorrecta.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Contacta a soporte@boosterchile.com.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese email. Inicia sesión.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usa al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El email no es válido.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Intenta de nuevo.';
    default:
      return null;
  }
}
