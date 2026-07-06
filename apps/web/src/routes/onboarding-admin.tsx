import { useSearch } from '@tanstack/react-router';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { OnboardingForm } from '../components/onboarding/OnboardingForm.js';
import type { MeResponse } from '../hooks/use-me.js';
import { useOnboardingAdminMutation } from '../hooks/use-onboarding-admin-mutation.js';

type MeNeedsOnboarding = Extract<MeResponse, { needs_onboarding: true }>;

interface OnboardingAdminSearch {
  token?: string;
}

/**
 * `/onboarding-admin?token=...` — alta de usuarios operativa (W1.3, hito
 * CORFO): consume el token de onboarding one-shot que el admin emite al
 * aprobar un `signup-request` (ver `/solicitar-acceso` y
 * `/app/platform-admin/signup-requests`).
 *
 * El aprobado ya tiene cuenta Firebase (creada por el approve del admin)
 * pero AÚN NO existe en la DB de Booster — de ahí
 * `meRequirement="allow-pre-onboarding"`, igual que `/onboarding` (el flujo
 * viejo SC3, que NO se toca: sigue siendo un dead-end permanente para
 * self-signup directo).
 *
 * Reutiliza `OnboardingForm` (mismo form de 4 pasos que `/onboarding`)
 * inyectándole `useOnboardingAdminMutation(token)`, que pega a
 * `POST /empresas/onboarding-admin` con el token en el header
 * `x-onboarding-token` — NUNCA como query param ni en el body (contrato del
 * backend, `apps/api/src/routes/empresas.ts`).
 *
 * Sin `?token=` en la URL: error inmediato y amable, sin montar
 * `ProtectedRoute` (no exige sesión Firebase) ni llamar a ningún endpoint —
 * el visitante pudo llegar con un link truncado o mal copiado.
 */
export function OnboardingAdminRoute() {
  const search = (useSearch({ strict: false }) ?? {}) as OnboardingAdminSearch;
  const token = search.token;

  if (!token) {
    return <TokenMissingPage />;
  }

  return (
    <ProtectedRoute meRequirement="allow-pre-onboarding">
      {(ctx) => {
        if (ctx.kind !== 'pre-onboarding') {
          return null;
        }
        return <OnboardingAdminPage me={ctx.me} token={token} />;
      }}
    </ProtectedRoute>
  );
}

function PageHeader() {
  return (
    <header className="border-neutral-200 border-b bg-white px-6 py-4">
      <div className="mx-auto flex max-w-6xl items-center gap-2">
        <img src="/icons/icon.svg" alt="" aria-hidden className="h-7 w-7" />
        <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
      </div>
    </header>
  );
}

function OnboardingAdminPage({ me, token }: { me: MeNeedsOnboarding; token: string }) {
  const firstName = me.firebase.name?.split(' ')[0];
  const mutation = useOnboardingAdminMutation(token);

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <PageHeader />

      <main className="flex flex-1 items-start justify-center px-6 py-10">
        <div className="w-full max-w-2xl">
          <div className="mb-6 text-center">
            <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
              Bienvenido{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-2 text-neutral-600 text-sm">
              Impacta menos, transporta más. En 2 minutos creamos tu empresa y empiezas a operar.
            </p>
          </div>

          <OnboardingForm
            firebaseEmail={me.firebase.email ?? ''}
            firebaseName={me.firebase.name}
            mutation={mutation}
          />
        </div>
      </main>
    </div>
  );
}

function TokenMissingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <PageHeader />

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Enlace incompleto</h1>
          <p className="mt-2 text-neutral-600 text-sm">
            Este enlace no incluye el código de acceso necesario para completar tu registro.
          </p>

          <div
            role="alert"
            className="mt-6 rounded-md border border-danger-500/30 bg-danger-50 p-3 text-danger-700 text-sm"
          >
            Verifica que copiaste la URL completa desde el enlace que te entregó el administrador, o
            solicita uno nuevo.
          </div>

          <p className="mt-6 text-center text-neutral-600 text-sm">
            <a
              href="/solicitar-acceso"
              data-testid="onboarding-admin-link-solicitar-acceso"
              className="font-medium text-primary-600 hover:underline"
            >
              Solicitar un enlace nuevo
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
