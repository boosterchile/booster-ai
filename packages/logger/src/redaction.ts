/**
 * Paths que Pino debe redactar automáticamente en cada log.
 *
 * Cubre:
 *  - Credentials (passwords, tokens, API keys, private keys)
 *  - PII (Ley 19.628 Chile + GDPR compat): emails, teléfonos, direcciones, RUTs
 *  - Datos de pago (tarjetas, CVV)
 *  - Firmas digitales
 *
 * Si un campo no está en esta lista pero contiene PII, debe añadirse aquí
 * ANTES de que el servicio vaya a producción.
 */
export const redactionPaths: string[] = [
  // Credentials
  '*.password',
  '*.passwd',
  '*.secret',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.authorization',
  '*.auth',
  '*.private_key',
  '*.privateKey',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',

  // PII Ley 19.628
  '*.email',
  '*.phone',
  '*.phoneNumber',
  '*.phone_number',
  '*.rut',
  '*.dni',
  '*.passport',
  '*.ssn',
  '*.address',
  '*.streetAddress',
  '*.street_address',
  '*.fullName',
  '*.full_name',

  // Datos de pago
  '*.creditCard',
  '*.credit_card',
  '*.cardNumber',
  '*.card_number',
  '*.cvv',
  '*.cvc',

  // Firmas digitales
  '*.signature',
  '*.digitalSignature',
  '*.digital_signature',

  // Otros
  '*.privateNotes',
  '*.private_notes',
];
