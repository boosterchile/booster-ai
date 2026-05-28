/**
 * Mensajes en español para los códigos de error más comunes de Firebase
 * Auth. Si el código no está mapeado, devuelve null y el caller usa un
 * fallback genérico.
 *
 * **Sprint 2c-B T2 extension**: handles `auth/internal-error` whose
 * message contains the `BLOCKED_SIGNUP_PENDING_APPROVAL` literal —
 * Firebase web SDK's wrapping for the Identity Platform Blocking
 * Function rejection (per ADR-054). The literal MUST equal the
 * `BLOCKED_CODE` constant inlined at
 * `apps/auth-blocking-functions/src/handler.ts:45`. Cross-source-of-
 * truth contract enforced by
 * `apps/auth-blocking-functions/test/integration/cross-source-literals.test.ts`.
 *
 * Scope: signup/login domain (provider sign-in + email/pw form errors).
 * Provider-linking errors are translated separately in
 * `apps/web/src/components/profile/AuthProvidersSection.tsx` because the
 * Spanish copy differs (e.g., `auth/email-already-in-use` for linking
 * vs signup-existing-account). Unification tracked in
 * `.specs/_followups/translate-auth-error-unify.md`.
 */
export function translateAuthError(code: string | undefined, message?: string): string | null {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Email o contraseña incorrectos.';
    case 'auth/user-not-found':
      return 'No existe una cuenta con ese email.';
    case 'auth/wrong-password':
      return 'Contraseña incorrecta.';
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada. Contacta a soporte@boosterchile.com.';
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese email. Inicia sesión.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usa al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El email no es válido.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Intenta de nuevo.';
    case 'auth/internal-error':
      if (message?.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')) {
        return 'Tu solicitud de registro debe ser aprobada por un administrador antes de poder iniciar sesión. Si ya solicitaste registro, espera la confirmación por email.';
      }
      return null;
    default:
      return null;
  }
}
