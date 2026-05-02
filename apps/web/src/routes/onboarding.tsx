import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { OnboardingForm } from '../components/onboarding/OnboardingForm.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeNeedsOnboarding = Extract<MeResponse, { needs_onboarding: true }>;

/**
 * /onboarding — flow de creación de empresa para users que se acaban de
 * registrar en Firebase pero no existen todavía en la DB de Booster.
 *
 * Form de 4 pasos: tus datos → empresa + dirección → tipo de operación
 * (shipper/carrier) → plan + confirmación. Submit POST /empresas/onboarding,
 * que crea user+empresa+membership en transacción y deja al user listo
 * para operar. Redirige a /app tras éxito.
 */
export function OnboardingRoute() {
  return (
    <ProtectedRoute meRequirement="allow-pre-onboarding">
      {(ctx) => {
        if (ctx.kind !== 'pre-onboarding') {
          return null;
        }
        return <OnboardingPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function OnboardingPage({ me }: { me: MeNeedsOnboarding }) {
  const firstName = me.firebase.name?.split(' ')[0];

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
          <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              Bienvenido{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-2 text-neutral-600 text-sm">
              En 2 minutos creamos tu empresa y empiezas a operar.
            </p>
          </div>

          <OnboardingForm firebaseEmail={me.firebase.email ?? ''} firebaseName={me.firebase.name} />
        </div>
      </main>
    </div>
  );
}
