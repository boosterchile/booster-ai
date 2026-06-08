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
 * monta. Con el kill-switch off, el form no se renderiza (defensa nivel 1).
 *
 * La defensa real contra captación es de DOBLE NIVEL: (1) `NEXT_PUBLIC_SIGNUP_
 * ENABLED` off y (2) ausencia de `www.boosterchile.com` en `CORS_ALLOWED_
 * ORIGINS` del api — aunque alguien forzara el submit, el POST cross-origin
 * fallaría. Un `NEXT_PUBLIC_*` es client-side y débil por sí solo. Ver
 * `.specs/marketing-site-signup-request/spec.md` §SC8/§9 y review O2/O3.
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
