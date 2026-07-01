import { ensureRutHasDash, normalizePhone, rutSchema } from '@booster-ai/shared-schemas';

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
  // Variantes de RUT en documentos tributarios de transporte (review F4-4a
  // finding 6): emisor/receptor en camelCase (manual-entry body) y snake_case
  // (payloads/rows DB). Defensa en profundidad — la value-based redaction ya
  // cubre RUTs en strings, esto los redacta también por path.
  '*.rutEmisor',
  '*.rut_emisor',
  '*.rutReceptor',
  '*.rut_receptor',
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

// ----------------------------------------------------------------------------
// Value-based redaction (T4 SC-H4.1) — regex sobre VALORES de strings
// ----------------------------------------------------------------------------
//
// Complementa la path-based redaction (Pino redact paths) para catch PII que
// aparece dentro de strings (mensajes libres) o en fields con nombres no
// allowlisted. Aplicado vía `formatters.log` en createLogger.

// Username/domain split en segmentos `\w+` con separadores single-char
// (`[.+\-]` y `[.\-]`). Sin char class overlap entre segmentos y separadores
// → CodeQL js/polynomial-redos safe (cada `\w+` es greedy single-class
// unambiguous; separadores son single chars sin quantifier).
const EMAIL_RE = /\w+(?:[.+\-]\w+)*@\w+(?:[.-]\w+)+/g;
const JWT_RE = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const RUT_RE = /\b\d{7,8}-?[\dkK]\b/g;
// Phone-candidate: optional `+`, comienza y termina con dígito; medio puede
// tener separadores single-char (espacios, dashes, parens). Anclar en dígitos
// evita consumir spaces de bordes. Validación real vía normalizePhone (T2):
// non-Chile o formato inválido → null → no redacta.
const PHONE_RE = /\+?\d[\d \t\-()]{6,18}\d/g;
const SENSITIVE_KEY_RE = /pass|secret|token|key|auth/i;

function isValidRut(candidate: string): boolean {
  return rutSchema.safeParse(ensureRutHasDash(candidate)).success;
}

/**
 * Redacta PII patterns en una string: emails, JWTs, RUTs (con módulo-11
 * check para evitar false positives sobre números aleatorios).
 */
export function redactValue(input: string): string {
  let out = input.replace(EMAIL_RE, '[REDACTED:email]').replace(JWT_RE, '[REDACTED:jwt]');
  out = out.replace(RUT_RE, (match) => (isValidRut(match) ? '[REDACTED:rut]' : match));
  // Phone después de RUT para que RUTs válidos no se confundan con phone candidates.
  out = out.replace(PHONE_RE, (match) =>
    normalizePhone(match) !== null ? '[REDACTED:phone]' : match,
  );
  return out;
}

/**
 * Walks recursive un object/array; redacta strings via `redactValue` + reemplaza
 * values donde la KEY matchea sensitive pattern (/pass|secret|token|key|auth/i).
 * Protege contra circular refs via WeakSet.
 */
export function redactObjectValues(
  obj: unknown,
  visited: WeakSet<object> = new WeakSet(),
): unknown {
  if (typeof obj === 'string') {
    return redactValue(obj);
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (visited.has(obj as object)) {
    return obj;
  }
  visited.add(obj as object);
  if (Array.isArray(obj)) {
    return obj.map((v) => redactObjectValues(v, visited));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[REDACTED:password]';
    } else {
      out[k] = redactObjectValues(v, visited);
    }
  }
  return out;
}
