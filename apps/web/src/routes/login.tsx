import { Navigate, useNavigate } from '@tanstack/react-router';
import type { FirebaseError } from 'firebase/app';
import { LogIn } from 'lucide-react';
import { useState } from 'react';
import { signInWithGoogle, useAuth } from '../hooks/use-auth.js';

/**
 * /login — pantalla de autenticación.
 *
 * Slice piloto: Google sign-in con popup. En B.3.c agregamos
 * email/password. Tras login exitoso redirige a /app que rutea según
 * `needs_onboarding` desde /me.
 */
export function LoginRoute() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) {
    return <Navigate to="/app" />;
  }

  async function handleGoogleSignIn() {
    setSigning(true);
    setError(null);
    try {
      await signInWithGoogle();
      void navigate({ to: '/app' });
    } catch (err) {
      const fbErr = err as FirebaseError;
      if (
        fbErr.code === 'auth/popup-closed-by-user' ||
        fbErr.code === 'auth/cancelled-popup-request'
      ) {
        return;
      }
      setError(fbErr.message ?? 'No pudimos iniciar sesión. Probá de nuevo.');
    } finally {
      setSigning(false);
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

      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Iniciá sesión</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            Plataforma de logística sostenible. Si tu empresa todavía no está registrada, podrás
            crearla en el siguiente paso.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={signing || loading}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-md border border-neutral-300 bg-white px-4 py-3 font-medium text-neutral-900 text-sm shadow-xs transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" aria-hidden />
            {signing ? 'Conectando…' : 'Continuar con Google'}
          </button>

          <p className="mt-6 text-neutral-500 text-xs">
            Al continuar aceptás los términos del servicio y la política de privacidad de Booster
            AI.
          </p>
        </div>
      </main>
    </div>
  );
}
