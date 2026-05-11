import { Navigate, useNavigate } from '@tanstack/react-router';
import type { FirebaseError } from 'firebase/app';
import { LogIn, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass } from '../components/FormField.js';
import {
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  useAuth,
} from '../hooks/use-auth.js';

type Mode = 'sign-in' | 'sign-up' | 'reset';

interface LoginFormValues {
  name: string;
  email: string;
  password: string;
}

const EMPTY_VALUES: LoginFormValues = { name: '', email: '', password: '' };

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
  const [resetSent, setResetSent] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    mode: 'onSubmit',
    defaultValues: EMPTY_VALUES,
  });

  // Cambiar mode resetea el form y limpia mensajes en una sola operación.
  // Más explícito que un useEffect con [mode] como deps.
  function changeMode(next: Mode) {
    setMode(next);
    reset(EMPTY_VALUES);
    setResetSent(false);
  }

  if (user) {
    return <Navigate to="/app" />;
  }

  async function handleGoogleSignIn() {
    setResetSent(false);
    try {
      await signInWithGoogle();
      void navigate({ to: '/app' });
    } catch (err) {
      const code = (err as FirebaseError).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setError('root', {
        message: translateAuthError(code) ?? 'No pudimos iniciar sesión con Google.',
      });
    }
  }

  /**
   * Validación condicional según mode + ejecución del flow Firebase.
   * Los 3 modos comparten email; sign-in/sign-up usan password adicional;
   * sign-up usa también name. RHF default no tiene "schema condicional",
   * validamos a mano antes de invocar Firebase.
   */
  async function submit(values: LoginFormValues) {
    setResetSent(false);

    const emailParsed = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email);
    if (!emailParsed) {
      setError('email', { type: 'manual', message: 'Email inválido.' });
      return;
    }

    if (mode === 'sign-up' && !values.name.trim()) {
      setError('name', { type: 'manual', message: 'Ingresa tu nombre.' });
      return;
    }

    if (mode !== 'reset' && values.password.length < 6) {
      setError('password', { type: 'manual', message: 'Mínimo 6 caracteres.' });
      return;
    }

    try {
      if (mode === 'sign-in') {
        await signInWithEmail(values.email, values.password);
        void navigate({ to: '/app' });
      } else if (mode === 'sign-up') {
        await signUpWithEmail({
          email: values.email,
          password: values.password,
          ...(values.name.trim() ? { displayName: values.name.trim() } : {}),
        });
        void navigate({ to: '/app' });
      } else {
        await requestPasswordReset(values.email);
        setResetSent(true);
      }
    } catch (err) {
      const code = (err as FirebaseError).code;
      setError('root', {
        message: translateAuthError(code) ?? 'No pudimos completar la operación.',
      });
    }
  }

  const submittedEmail = resetSent ? document.getElementById('login-email') : null;

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

          {errors.root?.message && (
            <div
              role="alert"
              className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
            >
              {errors.root.message}
            </div>
          )}

          {resetSent && (
            <output className="mt-6 block rounded-md border border-success-500/30 bg-success-50 p-3 text-sm text-success-700">
              Listo. Si {(submittedEmail as HTMLInputElement | null)?.value || 'el email'} existe,
              te llegó un email con el enlace para restablecer tu contraseña.
            </output>
          )}

          <form onSubmit={handleSubmit(submit)} className="mt-6 space-y-4" noValidate>
            {mode === 'sign-up' && (
              <FormField
                label="Tu nombre"
                required
                error={errors.name?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="text"
                    autoComplete="name"
                    {...register('name')}
                    className={inputClass(!!errors.name)}
                  />
                )}
              />
            )}

            <FormField
              label="Email"
              required
              error={errors.email?.message}
              render={({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="email"
                  autoComplete="email"
                  {...register('email')}
                  className={inputClass(!!errors.email)}
                />
              )}
            />

            {mode !== 'reset' && (
              <FormField
                label="Contraseña"
                required
                hint={mode === 'sign-up' ? 'Mínimo 6 caracteres.' : undefined}
                error={errors.password?.message}
                render={({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    type="password"
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                    {...register('password')}
                    className={inputClass(!!errors.password)}
                  />
                )}
              />
            )}

            <button
              type="submit"
              disabled={isSubmitting || loading}
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
                  {isSubmitting ? 'Conectando…' : 'Entrar'}
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
                disabled={isSubmitting || loading}
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
                    onClick={() => changeMode('sign-up')}
                    className="font-medium text-primary-600 hover:underline"
                  >
                    Crea una
                  </button>
                </p>
                <p>
                  <button
                    type="button"
                    onClick={() => changeMode('reset')}
                    className="font-medium text-primary-600 hover:underline"
                  >
                    Olvidé mi contraseña
                  </button>
                </p>
                {/* D9 — Link al login dedicado de conductores (RUT + PIN).
                    Es una surface distinta porque los conductores no tienen
                    email, solo RUT + PIN/password sintético. */}
                <p>
                  ¿Eres conductor?{' '}
                  <a
                    href="/login/conductor"
                    className="font-medium text-primary-600 hover:underline"
                    data-testid="login-link-conductor"
                  >
                    Ingresar con RUT
                  </a>
                </p>
              </>
            )}
            {mode === 'sign-up' && (
              <p>
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  onClick={() => changeMode('sign-in')}
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
                  onClick={() => changeMode('sign-in')}
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
