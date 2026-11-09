import { CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS } from '@booster-ai/shared-schemas';
import { ShieldCheck } from 'lucide-react';
import { Layout } from '../components/Layout.js';
import { ProtectedRoute } from '../components/ProtectedRoute.js';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

/**
 * `/app/confirmar-acceso-booster` (`.specs/confirmar-acceso-booster` SC18).
 *
 * Cuando el panel del personal da de alta a alguien cuya cuenta ya es de una
 * empresa, el acceso al panel de Booster lo confirma la propia persona, con su
 * sesión iniciada, ingresando el código que el admin le entregó en persona.
 */
export function ConfirmarAccesoBoosterRoute() {
  return (
    <ProtectedRoute meRequirement="require-onboarded">
      {(ctx) => (ctx.kind === 'onboarded' ? <ConfirmarAccesoBoosterPage me={ctx.me} /> : null)}
    </ProtectedRoute>
  );
}

function ConfirmarAccesoBoosterPage({ me }: { me: MeOnboarded }) {
  return (
    <Layout me={me} title="Confirmar acceso de Booster">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 shrink-0 text-primary-700" aria-hidden />
          <h1 className="font-bold text-3xl text-neutral-900 tracking-tight">
            Confirmar acceso de Booster
          </h1>
        </div>
        <p className="mt-2 text-neutral-600 text-sm">
          {`Si el equipo de Booster te dio acceso a su panel de administración, te entregó en persona un código de 6 números. Ingrésalo aquí con tu sesión iniciada. Vence ${CONFIRMACION_ACCESO_BOOSTER_VIGENCIA_HORAS} horas después de que te lo entregan.`}
        </p>
        <p className="mt-2 text-neutral-600 text-sm">
          Si nadie de Booster te entregó un código, no tienes que hacer nada aquí: tu cuenta sigue
          igual.
        </p>
      </div>
    </Layout>
  );
}
