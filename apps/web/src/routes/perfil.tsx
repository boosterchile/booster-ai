import { Link } from '@tanstack/react-router';
import { ArrowLeft, LogOut, User as UserIcon } from 'lucide-react';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { ProfileForm } from '../components/profile/ProfileForm.js';
import { signOutUser } from '../hooks/use-auth.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * /app/perfil — edición del perfil del usuario logueado.
 *
 * Permite cambiar full_name, phone, whatsapp_e164 y (si está null) rut.
 * El email y la empresa activa se gestionan por separado.
 */
export function PerfilRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => {
        if (ctx.kind !== 'onboarded') {
          return null;
        }
        return <PerfilPage me={ctx.me} />;
      }}
    </ProtectedRoute>
  );
}

function PerfilPage({ me }: { me: MeOnboarded }) {
  const activeEmpresa = me.active_membership?.empresa;

  async function handleSignOut() {
    await signOutUser();
  }

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="border-neutral-200 border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link to="/app" className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-md bg-primary-500" aria-hidden />
              <span className="font-semibold text-lg text-neutral-900">Booster AI</span>
            </Link>
            {activeEmpresa && (
              <span className="ml-3 rounded-md bg-neutral-100 px-2 py-1 font-medium text-neutral-700 text-xs">
                {activeEmpresa.legal_name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-md px-2 py-1 text-neutral-700 text-sm">
              <UserIcon className="h-4 w-4" aria-hidden />
              <span>{me.user.full_name}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-neutral-600 text-sm transition hover:bg-neutral-100"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <Link
            to="/app"
            className="mb-4 inline-flex items-center gap-1 text-neutral-600 text-sm transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Volver al inicio
          </Link>
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Mi cuenta</h1>
          <p className="mt-1 text-neutral-600 text-sm">
            Mantén tus datos al día para recibir notificaciones y cumplir requisitos
            administrativos.
          </p>

          <div className="mt-8">
            <ProfileForm
              initial={{
                full_name: me.user.full_name,
                phone: me.user.phone,
                whatsapp_e164: me.user.whatsapp_e164,
                rut: me.user.rut,
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
