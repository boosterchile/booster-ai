import { Navigate, useNavigate, useSearch } from '@tanstack/react-router';
import type { FirebaseError } from 'firebase/app';
import { LogIn, Mail } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, inputClass } from '../components/FormField.js';
import { LoginUniversal } from '../components/login/LoginUniversal.js';
import {
  requestPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  useAuth,
} from '../hooks/use-auth.js';
import { useFeatureFlags } from '../hooks/use-feature-flags.js';
import { translateLoginAuthError } from '../lib/translate-auth-error.js';

type Mode = 'sign-in' | 'sign-up' | 'reset';

interface LoginFormValues {
  name: string;
  email: string;
  password: string;
}

const EMPTY_VALUES: LoginFormValues = { name: '', email: '', password: '' };

/**
 * /login — pantalla de autenticación.
 *
 * ADR-035 (Wave 4) — dual flow basado en feature flag:
 *   - Si `auth_universal_v1_activated=true`: renderiza `<LoginUniversal>`
 *     con selector tipo usuario + form RUT + clave numérica.
 *   - Si `auth_universal_v1_activated=false` (default): legacy flow
 *     con Google + email/password + password reset.
 *
 * Escape hatch: `?legacy=1` en la URL fuerza el flow legacy aunque el
 * flag esté ON. Usado por `LoginUniversal` cuando el user necesita
 * rotar su clave numérica desde su método anterior (Wave 4 PR 3 wire).
 *
 * Tras login exitoso → /app, que decide via /me si va a /onboarding o
 * directo al dashboard según `needs_onboarding`. Excepción: si llegamos acá
 * con `?redirect=` (seteado por `ProtectedRoute` cuando un no-autenticado
 * pedía una ruta protegida, ej. `/onboarding-admin?token=...` del alta
 * gateada por admin — W1.3), navegamos ahí en vez de a `/app` para no perder
 * el destino original. `safeRedirectTarget` valida que sea un path relativo
 * propio (nunca una URL externa) antes de usarlo — mitigación de open-redirect.
 */
export function LoginRoute() {
  const { user, loading } = useAuth();
  const { flags, isLoading: flagsLoading } = useFeatureFlags();
  const search = (useSearch({ strict: false }) ?? {}) as { legacy?: string; redirect?: string };
  const navigate = useNavigate();
  const postLoginTarget = safeRedirectTarget(search.redirect) ?? '/app';
  const [mode, setMode] = useState<Mode>('sign-in');
  const [resetSent, setResetSent] = useState(false);

  // Si el flag está ON y el user NO forzó legacy, ruta al flow universal.
  // Re-evaluamos esto tras `user`/loading checks debajo para mantener la
  // semántica del legacy (Navigate to /app si ya logueado).
  const useUniversalFlow = flags.auth_universal_v1_activated && search.legacy !== '1';

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

  // demo.boosterchile.com NO debe servir /login — el login real vive en
  // app.boosterchile.com. Si el user llega acá (típicamente post-logout
  // desde un surface /app/* en host demo), lo redirigimos al selector
  // de personas en vez de mostrar el form de login.
  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const isDemoHost = host === 'demo.boosterchile.com' || host === 'demo.localhost';
  if (isDemoHost) {
    return <Navigate to="/demo" />;
  }

  // Esperar a que los feature flags resuelvan antes de elegir el flujo. Sin
  // esto, el form legacy (email/password) parpadea ~2s antes de que llegue
  // `auth_universal_v1_activated` y conmute al flujo universal (RUT + clave
  // numérica). El default OFF durante la carga causaba ese flash.
  if (flagsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <output className="text-neutral-600 text-sm">Cargando…</output>
      </div>
    );
  }

  if (useUniversalFlow) {
    return <LoginUniversal />;
  }

  async function handleGoogleSignIn() {
    setResetSent(false);
    try {
      await signInWithGoogle();
      void navigate({ to: postLoginTarget });
    } catch (err) {
      const code = (err as FirebaseError).code;
      const message = (err as FirebaseError).message;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setError('root', {
        message: translateLoginAuthError(code, message) ?? 'No pudimos iniciar sesión con Google.',
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
        void navigate({ to: postLoginTarget });
      } else if (mode === 'sign-up') {
        await signUpWithEmail({
          email: values.email,
          password: values.password,
          ...(values.name.trim() ? { displayName: values.name.trim() } : {}),
        });
        void navigate({ to: postLoginTarget });
      } else {
        await requestPasswordReset(values.email);
        setResetSent(true);
      }
    } catch (err) {
      const code = (err as FirebaseError).code;
      const message = (err as FirebaseError).message;
      setError('root', {
        message: translateLoginAuthError(code, message) ?? 'No pudimos completar la operación.',
      });
    }
  }

  const submittedEmail = resetSent ? document.getElementById('login-email') : null;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <img src="/icons/icon.svg" alt="" aria-hidden className="h-7 w-7" />
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
                {/* SEC-001 Sprint 2b (ADR-052) — alta gateada por admin.
                    Reemplaza el self-signup directo de Firebase (mode
                    "sign-up" arriba, aún vigente hasta que se retire en un
                    follow-up): el visitante pide acceso y un admin
                    aprueba/rechaza desde /app/platform-admin/signup-requests. */}
                <p>
                  ¿No tienes cuenta?{' '}
                  <a
                    href="/solicitar-acceso"
                    className="font-medium text-primary-600 hover:underline"
                    data-testid="login-link-solicitar-acceso"
                  >
                    Solicita acceso
                  </a>
                </p>
                <p className="mt-3 border-neutral-200 border-t pt-3 text-neutral-500 text-xs">
                  ¿Admin de plataforma Booster?{' '}
                  <a
                    href="/app/platform-admin"
                    className="font-medium text-neutral-700 hover:underline"
                    data-testid="login-link-platform-admin"
                  >
                    Ir al panel admin
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
 * Valida que `redirect` (viene de `?redirect=` en la URL, seteado por
 * `ProtectedRoute` — W1.3) sea un path relativo de la propia app antes de
 * usarlo en `navigate()`. Mitigación de open-redirect: rechaza URLs
 * absolutas (`https://evil.example`), protocol-relative (`//evil.example`) y
 * cualquier valor con `\` (algunos navegadores normalizan `/\` a `//`).
 * `undefined`/vacío → `null` (el caller cae a `/app`).
 */
function safeRedirectTarget(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('://') || raw.includes('\\')) {
    return null;
  }
  return raw;
}
