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
 *
 * ---
 *
 * **T-SEC-032a — política de redacción top-level (plan v3.3, security-blocking-hotfixes-2026-05-14)**
 *
 * Pino redact con wildcard `*.email` matchea SOLO sub-paths (`{ user: { email } }`),
 * NO el campo top-level (`{ email }` en la raíz). Sites como
 * `apps/api/src/routes/auth-universal.ts:110,152,171` y
 * `apps/api/src/routes/me.ts:118-120` loggean PII top-level y quedaban en claro
 * en Cloud Logging — viola Ley 19.628 art. 5 (proporcionalidad) + GDPR.
 *
 * Las 12 keys "bare" abajo cierran el gap SEC-032.
 *
 * **NO REDACT — exención explícita**:
 *   - `userId`, `uid`, `messageId` — UUIDs sintéticos. Ley 19.628 art. 2 lit. f
 *     define "pseudonimización" como tratamiento legítimo cuando el identificador
 *     no permite reidentificar sin información adicional.
 *   - `ip`, `userAgent` — security.md SEC-033 los pide explícitamente en
 *     logs de auth-fail como evidencia de incident response. Redactarlos
 *     ciega forensia.
 *   - `path` — URL path, no PII.
 *   - `service`, `version`, `level`, `severity`, `time`, `pid`, `hostname` —
 *     Pino metadata, nunca PII.
 *
 * Antes de añadir cualquier nueva key bare, verificar contra esta lista:
 *  ¿es identificador directo de un sujeto natural? → REDACT.
 *  ¿es identificador sintético o metadata operacional? → exempt.
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

  // PII Ley 19.628 — wildcards (nested)
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

  // PII Ley 19.628 — top-level bare keys (T-SEC-032a, plan v3.3).
  // Ver bloque "T-SEC-032a — política" arriba. Razonamiento NO-REDACT documentado.
  'email',
  'rut',
  'phone',
  'phone_number',
  'phoneNumber',
  'whatsapp_e164',
  'whatsappE164',
  'full_name',
  'fullName',
  'dni',
  'firebase_uid',
  'firebaseUid',

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
