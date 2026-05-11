import { Link } from '@tanstack/react-router';
import { ArrowLeft, Headphones } from 'lucide-react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import { AuthProvidersSection } from '../components/profile/AuthProvidersSection.js';
import { ProfileForm } from '../components/profile/ProfileForm.js';
import { TwoFactorSection } from '../components/profile/TwoFactorSection.js';
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
  return (
    <Layout me={me} title="Mi cuenta">
      <div className="mx-auto max-w-3xl">
        <Link
          to="/app"
          className="mb-4 inline-flex items-center gap-1 text-neutral-600 text-sm transition hover:text-neutral-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver al inicio
        </Link>
        <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">Mi cuenta</h1>
        <p className="mt-1 text-neutral-600 text-sm">
          Mantén tus datos al día para recibir notificaciones y cumplir requisitos administrativos.
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

        <AuthProvidersSection />

        <TwoFactorSection initialPhoneE164={me.user.whatsapp_e164 ?? me.user.phone ?? null} />

        <section
          aria-label="Modo Conductor"
          className="mt-8 rounded-lg border border-neutral-200 bg-white p-5"
          data-testid="perfil-modo-conductor-section"
        >
          <div className="flex items-start gap-3">
            <Headphones className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden />
            <div className="flex-1">
              <h2 className="font-semibold text-base text-neutral-900">Modo Conductor</h2>
              <p className="mt-1 text-neutral-600 text-sm">
                Activa audio coaching automático, gestiona permisos de micrófono y GPS, y revisa los
                comandos de voz para operar sin tocar la pantalla mientras conduces.
              </p>
              <Link
                to="/app/conductor/modo"
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 font-medium text-sm text-white shadow-xs transition hover:bg-primary-700"
                data-testid="link-modo-conductor-perfil"
              >
                Configurar modo conductor
              </Link>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
