import type { SignupOutcome } from '../lib/signup-client.js';

export interface SignupFeedback {
  tone: 'success' | 'error';
  message: string;
}

/**
 * Mapea el resultado del signup-request a feedback de UI. El éxito (202) es
 * idéntico para email nuevo vs existente (anti-enumeration, ADR-052): un solo
 * mensaje, sin pistas sobre si el email ya existía. `network_error` cubre el
 * fallo de red / bloqueo CORS — el modo de fallo más probable del primer
 * deploy (review O4).
 */
export function signupFeedback(outcome: SignupOutcome): SignupFeedback {
  switch (outcome) {
    case 'submitted':
      // Sin promesa de contacto proactivo: el notifier email real aún no
      // existe (review P1-2). El modelo es aprobación admin antes de habilitar.
      return {
        tone: 'success',
        message: 'Recibimos tu solicitud. La revisaremos antes de habilitar tu acceso.',
      };
    case 'rate_limited':
      return {
        tone: 'error',
        message: 'Demasiados intentos. Intenta nuevamente en unos minutos.',
      };
    case 'invalid':
      return {
        tone: 'error',
        message: 'Revisa los datos ingresados e intenta de nuevo.',
      };
    case 'unavailable':
      return {
        tone: 'error',
        message: 'No pudimos procesar tu solicitud ahora. Intenta más tarde.',
      };
    case 'network_error':
      return {
        tone: 'error',
        message: 'No pudimos conectar. Revisa tu conexión e intenta más tarde.',
      };
  }
}
