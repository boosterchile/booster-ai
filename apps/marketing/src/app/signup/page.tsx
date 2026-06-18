import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import { ComingSoon } from '../../components/coming-soon.js';
import { isSignupEnabled } from '../../lib/env.js';

export const metadata: Metadata = {
  title: 'Solicitar acceso — Booster AI',
  description: 'Solicita acceso a Booster AI. Revisamos cada solicitud antes de activar la cuenta.',
};

/**
 * Code-split: el chunk del form solo se descarga (cliente) cuando el gate lo
 * monta. Con el kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED` off (build-time), el
 * form no se renderiza — el SITIO no muestra captación.
 *
 * IMPORTANTE (review P0-1): esto NO "cierra" el registro. El endpoint
 * `POST /api/v1/signup-request` es anónimo y ya está montado en producción
 * (ADR-052); CORS solo bloquea el navegador cross-origin, NO un POST no-browser
 * (curl/script). El kill-switch controla únicamente que este sitio muestre el
 * form. Que una solicitud prematura sea inocua hoy se debe al downstream
 * gateado (admin UI 503, sin notifier real, bug 409 approve→onboarding).
 * Encender el form exige el readiness de §11. Ver ADR-067 §"Aclaración de
 * seguridad".
 */
const SignupForm = dynamic(() =>
  import('../../components/signup-form.js').then((m) => m.SignupForm),
);

export default function SignupPage() {
  if (!isSignupEnabled()) {
    return <ComingSoon />;
  }
  return <SignupForm />;
}
