/**
 * Helpers de RUT chileno para presentación.
 *
 * El schema canónico de validación vive en
 * `@booster-ai/shared-schemas` (`rutSchema`). Este módulo agrega
 * formateo para display y una variante laxa de validación que acepta
 * input "sucio" (con o sin puntos / guión) — útil antes de mostrar al
 * usuario o para guardar inputs intermedios.
 */

/**
 * Devuelve solo dígitos y K mayúscula, sin puntos ni guión.
 */
function normalize(raw: string): string {
  return raw.replace(/[^0-9kK]/g, '').toUpperCase();
}

/**
 * Formatea un RUT crudo a `XX.XXX.XXX-D`.
 *
 * Si el input no tiene al menos 2 caracteres significativos (cuerpo +
 * dígito verificador) se devuelve el input original tal cual — útil
 * cuando el usuario está tipeando.
 *
 * No valida el dígito verificador; eso es responsabilidad de
 * `isValidRut` o del schema canónico.
 */
export function formatRut(raw: string): string {
  const cleaned = normalize(raw);
  if (cleaned.length < 2) {
    return raw;
  }
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const withDots = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

/**
 * Verifica el dígito verificador de un RUT (algoritmo módulo 11).
 *
 * Acepta el input con o sin puntos/guión. Devuelve `false` si el RUT
 * es muy corto (cuerpo < 1 dígito) o si el dígito verificador no
 * coincide.
 */
export function isValidRut(raw: string): boolean {
  const cleaned = normalize(raw);
  if (cleaned.length < 2) {
    return false;
  }
  const body = cleaned.slice(0, -1);
  const expectedDv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) {
    return false;
  }
  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const digit = body[i];
    if (digit === undefined) {
      continue;
    }
    sum += Number.parseInt(digit, 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const computedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return computedDv === expectedDv;
}
