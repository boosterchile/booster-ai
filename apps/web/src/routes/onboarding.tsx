import { Navigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/use-auth.js';
import { useMe } from '../hooks/use-me.js';

/**
 * /onboarding — flow de creación de empresa para users que se acaban de
 * registrar en Firebase pero no existen todavía en la DB de Booster.
 *
 * Slice B.3.b: solo placeholder (redirect a /app si ya está onboardeado).
 * El form completo viene en B.4 (4 pasos: empresa → tipo de operación →
 * plan → confirmación).
 */
export function OnboardingRoute() {
  const { user, loading: authLoading } = useAuth();
  const { data: me, isLoading: meLoading } = useMe({ enabled: !!user });

  if (authLoading || meLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <div className="font-medium text-neutral-500 text-sm">Cargando…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  if (me && me.needs_onboarding === false) {
    return <Navigate to="/app" />;
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
        <div className="w-full max-w-md text-center">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Creá tu empresa en Booster
          </h1>
          <p className="mt-3 text-neutral-600 text-sm">
            Hola
            {me?.needs_onboarding && me.firebase.name ? `, ${me.firebase.name.split(' ')[0]}` : ''}.
            Completá los datos de tu empresa para empezar a operar. Tomamos 2 minutos.
          </p>

          <div className="mt-10 rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
            <p className="text-neutral-700 text-sm">
              Form de onboarding en construcción (slice B.4). Por ahora, contactá a soporte para
              registrar tu empresa manualmente:{' '}
              <a
                href="mailto:soporte@boosterchile.com"
                className="font-medium text-primary-600 underline"
              >
                soporte@boosterchile.com
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
