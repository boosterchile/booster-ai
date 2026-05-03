/**
 * Errores tipados del package. Cada uno mapea a un comportamiento HTTP
 * esperado en `apps/document-service`:
 *
 * | Error                            | HTTP recomendado |
 * |----------------------------------|------------------|
 * | DteValidationError               | 400 Bad Request  |
 * | DteCertificateError              | 422 Unprocessable Entity |
 * | DteRejectedBySiiError            | 422 (negocio)    |
 * | DteFolioConflictError            | 409 Conflict     |
 * | DteNotFoundError                 | 404 Not Found    |
 * | DteProviderUnavailableError      | 503 (transient)  |
 * | DteProviderError (fallback)      | 502 Bad Gateway  |
 *
 * Todas extienden `Error` con metadata estructurada para logs.
 */

/**
 * Error base. Cualquier fallo del provider que no sea uno de los
 * específicos cae acá. El caller puede ramificar `instanceof` por la
 * subclass; si no matchea, asumir 502.
 */
export class DteProviderError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DteProviderError';
  }
}

/**
 * El input no pasó el schema Zod o el provider rechazó por validación
 * formato (RUT mal formado, fecha futura, items vacíos, etc.). El caller
 * debe corregir el input antes de reintentar.
 */
export class DteValidationError extends DteProviderError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DteValidationError';
  }
}

/**
 * SII rechazó el documento por contenido (RUT no inscrito, glosa
 * inválida, monto fuera de rango, etc.). Distinto de
 * `DteValidationError` porque acá el formato era OK pero el negocio no.
 */
export class DteRejectedBySiiError extends DteProviderError {
  constructor(
    message: string,
    public readonly siiErrorCode: string,
    public readonly siiErrorDetail: string,
  ) {
    super(message);
    this.name = 'DteRejectedBySiiError';
  }
}

/**
 * El provider devolvió un folio que ya existe (race condition entre dos
 * intentos de emit con la misma referencia externa, o un retry sin
 * idempotency key). El caller debe queryStatus con el folio existente.
 */
export class DteFolioConflictError extends DteProviderError {
  constructor(
    message: string,
    public readonly folio: string,
  ) {
    super(message);
    this.name = 'DteFolioConflictError';
  }
}

/**
 * El certificado digital del emisor no se pudo cargar, está vencido, o
 * no coincide con el RUT del emisor. Bloqueante operativo — no se puede
 * emitir hasta resolver.
 */
export class DteCertificateError extends DteProviderError {
  constructor(
    message: string,
    public readonly rutEmisor: string,
  ) {
    super(message);
    this.name = 'DteCertificateError';
  }
}

/**
 * Provider externo no responde, timeout, 5xx. Transient — el caller
 * puede reintentar con exponential backoff.
 */
export class DteProviderUnavailableError extends DteProviderError {
  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'DteProviderUnavailableError';
  }
}

/**
 * `queryStatus` no encontró el folio para ese (rutEmisor, tipoDte).
 * Puede significar: folio no fue emitido, expiró del cache del provider,
 * o el RUT está mal. El caller tiene que decidir si es bug o no.
 */
export class DteNotFoundError extends DteProviderError {
  constructor(
    message: string,
    public readonly folio: string,
    public readonly rutEmisor: string,
  ) {
    super(message);
    this.name = 'DteNotFoundError';
  }
}
