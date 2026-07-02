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
 *
 * **Colocación (translate-auth-error-unify, Opción B)**: el dominio de
 * provider-linking (`translateProviderAuthError`, abajo) vive en ESTE mismo
 * módulo pero como función separada — el copy en español DIFIERE
 * deliberadamente por dominio (ej. `auth/email-already-in-use`: login dice
 * "Inicia sesión", linking dice "Cerrá sesión y entrá con esa cuenta"). Dos
 * tablas, un archivo: la divergencia es visible y se evita el drift de tener
 * la función inline en el componente.
 */
export function translateLoginAuthError(code: string | undefined, message?: string): string | null {
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

/**
 * Mensajes en español para el dominio de **provider-linking** (vincular/
 * desvincular/re-link de providers OAuth en el perfil). Copy diferenciado del
 * dominio de login: aquí los errores apuntan a la cuenta del usuario (ej.
 * "Cerrá sesión y entrá con esa cuenta directamente"), no al flujo de signup.
 *
 * Extraído verbatim desde `AuthProvidersSection.tsx` (translate-auth-error-unify
 * Opción B). Si un código gana copy en ambos dominios, mantenerlos separados es
 * intencional — la divergencia es de UX, no un bug.
 */
export function translateProviderAuthError(code: string | undefined): string | null {
  switch (code) {
    case 'auth/credential-already-in-use':
    case 'auth/email-already-in-use':
      return 'Esa cuenta ya pertenece a otro usuario de Booster. Cerrá sesión y entrá con esa cuenta directamente.';
    case 'auth/provider-already-linked':
      return 'Este proveedor ya está vinculado a tu cuenta.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usá al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El email no es válido.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email o contraseña incorrectos.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó el popup. Permite popups para app.boosterchile.com.';
    case 'auth/no-such-provider':
      return 'No puedes quitar este proveedor porque es el único que tienes.';
    case 'auth/network-request-failed':
      return 'Sin conexión a internet. Inténtalo de nuevo.';
    default:
      return null;
  }
}
