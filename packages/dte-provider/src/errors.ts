/**
 * Errores canónicos del package. Cada adapter traduce errores de su
 * API específica a una de estas clases para que el caller (services
 * en apps/api) maneje un set fijo sin acoplarse a Sovos vs Bsale.
 */

/** Base class — todos los errores del package extienden esta. */
export class DteProviderError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DteProviderError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * El adapter requiere credenciales y no están configuradas (env vars
 * faltantes, secret manager inaccesible, etc.). El caller debería
 * skipear silenciosamente con warn — la liquidación queda en estado
 * `lista_para_dte` hasta que se configure el provider.
 */
export class DteNotConfiguredError extends DteProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'DteNotConfiguredError';
  }
}

/**
 * Validación de input falló antes de llamar al provider (RUT
 * inválido, items vacíos, fecha mal formada). Bug del caller. NO
 * retry — el caller debe corregir el payload.
 */
export class DteValidationError extends DteProviderError {
  constructor(
    message: string,
    public readonly zodIssues?: unknown,
  ) {
    super(message);
    this.name = 'DteValidationError';
  }
}

/**
 * Error transitorio: timeout, 5xx, conexión caída. El caller PUEDE
 * reintentar con backoff. El service orquestador típicamente loggea
 * warn y deja al cron de reemisión retomar.
 */
export class DteTransientError extends DteProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'DteTransientError';
  }
}

/**
 * El provider respondió con 4xx no recuperable (cert inválido,
 * cuenta sin permisos, folio duplicado en SII). El caller NO debe
 * reintentar automáticamente — escalar a operador humano.
 */
export class DteProviderRejectedError extends DteProviderError {
  constructor(
    message: string,
    public readonly providerCode: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'DteProviderRejectedError';
  }
}
