import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeNeedsOnboarding = Extract<MeResponse, { needs_onboarding: true }>;

/**
 * /onboarding — flow de creación de empresa para users que se acaban de
 * registrar en Firebase pero no existen todavía en la DB de Booster.
 *
 * Slice B.3.b/c: solo placeholder con email a soporte. El form completo
 * de 4 pasos (empresa → tipo de operación → plan → confirmación) viene
 * en B.4 junto con el endpoint POST /empresas/onboarding.
 */
export function OnboardingRoute() {
  return (
    <ProtectedRoute meRequirement="allow-pre-onboarding">
      {(ctx) => {
        if (ctx.kind !== 'pre-onboarding') {
          return null;
        }
        return <OnboardingPlaceholder me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function OnboardingPlaceholder({ me }: { me: MeNeedsOnboarding }) {
  const firstName = me.firebase.name?.split(' ')[0];

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
            Hola{firstName ? `, ${firstName}` : ''}. Completá los datos de tu empresa para empezar a
            operar. Tomamos 2 minutos.
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
