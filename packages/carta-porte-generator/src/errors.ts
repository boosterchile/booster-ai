/**
 * Errores tipados del package. Mapping a HTTP recomendado:
 *
 * | Error                          | HTTP |
 * |--------------------------------|------|
 * | CartaPorteValidationError      | 400  |
 * | CartaPorteRenderError          | 500  |
 */

export class CartaPorteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CartaPorteError';
  }
}

export class CartaPorteValidationError extends CartaPorteError {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'CartaPorteValidationError';
  }
}

export class CartaPorteRenderError extends CartaPorteError {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CartaPorteRenderError';
  }
}
