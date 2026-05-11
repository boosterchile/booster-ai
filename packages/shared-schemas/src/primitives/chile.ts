import { z } from 'zod';

/**
 * Validación RUT chileno. Acepta input con o sin puntos
 * (12345678-9 o 12.345.678-9). Normaliza al canónico **sin puntos** con
 * dígito verificador K en mayúscula. Incluye check del dígito verificador.
 *
 * Persiste canónico para que lookups por RUT (login conductor, búsqueda
 * de user existente al crear conductor) sean estables sin importar cómo
 * el usuario tipeó la entrada.
 */
export const rutSchema = z
  .string()
  .regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/, 'RUT con formato inválido (ej: 12345678-5)')
  .refine(validateRutCheckDigit, 'Dígito verificador de RUT inválido')
  .transform(normalizeRut);

/**
 * Normaliza RUT a canónico: sin puntos, con guión, K mayúscula.
 * Ej: "12.345.678-k" → "12345678-K"
 */
export function normalizeRut(raw: string): string {
  return raw.replace(/\./g, '').toUpperCase();
}

/**
 * Formatea un RUT canónico (sin puntos) para display con separadores
 * de miles. Ej: "12345678-5" → "12.345.678-5".
 *
 * Si el input no matchea el patrón canónico, lo devuelve tal cual
 * (defensivo — no rompemos UI con datos legacy).
 */
export function formatRutForDisplay(canonical: string): string {
  const m = canonical.match(/^(\d{1,2})(\d{3})(\d{3})-([\dkK])$/);
  if (!m) {
    return canonical;
  }
  return `${m[1]}.${m[2]}.${m[3]}-${m[4]}`;
}

function validateRutCheckDigit(rut: string): boolean {
  const cleaned = rut.replace(/\./g, '').replace('-', '').toUpperCase();
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
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
  const expectedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return dv === expectedDv;
}

/**
 * Número de teléfono Chile: +569XXXXXXXX (celular) o +56XXXXXXXXX (fijo).
 */
export const chileanPhoneSchema = z
  .string()
  .regex(/^\+56[2-9]\d{8}$/, 'Número de teléfono Chile inválido');

/**
 * Código de región Chile (I-XVI / metropolitana).
 */
export const regionCodeSchema = z.enum([
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
]);

// ----------------------------------------------------------------------------
// Patente vehicular chilena
// ----------------------------------------------------------------------------

/**
 * Formato canónico (sin separadores, mayúsculas) de una patente chilena válida.
 *
 * Acepta dos estructuras:
 *   - **Nueva (post-2007)**: 4 letras seguidas de 2 dígitos. Ej: `BCDF12`,
 *     mostrada como `BC·DF·12`.
 *   - **Legacy**: 4 letras + 2 dígitos también, pero se origina de un patrón
 *     histórico distinto (`AAAA-BB`). La estructura canónica resultante es
 *     idéntica a la nueva — la diferencia visual es estética del display.
 *
 * Notas:
 *   - El formato real chileno tiene patrones más complejos (ej. `BBBB·12` para
 *     particulares antiguos vs `BC·DF·12` actual), pero a nivel de regex
 *     ambos colapsan a `[A-Z]{4}\d{2}`. Esta validación cubre los dos.
 *   - Patentes especiales (CD, PR, gobierno) no están soportadas; si aparecen
 *     en producción, agregar una regex separada.
 */
const CANONICAL_PLATE_RE = /^[A-Z]{4}\d{2}$/;

/**
 * Quita separadores comunes (·, -, ., espacios) y normaliza a mayúsculas.
 * No valida — solo convierte. La validación la hace `chileanPlateSchema`.
 */
export function normalizePlate(raw: string): string {
  return raw.replace(/[\s\-·.]/g, '').toUpperCase();
}

/**
 * `true` si `raw` (con o sin separadores, en cualquier capitalización) es una
 * patente chilena con formato válido.
 */
export function isValidChileanPlate(raw: string): boolean {
  return CANONICAL_PLATE_RE.test(normalizePlate(raw));
}

/**
 * Formatea una patente canónica para display estético: `BCDF12` → `BC·DF·12`.
 * Si el input no es una patente canónica, lo devuelve tal cual (defensivo —
 * no queremos romper UI con datos legacy raros).
 */
export function formatPlateForDisplay(canonical: string): string {
  if (!CANONICAL_PLATE_RE.test(canonical)) {
    return canonical;
  }
  return `${canonical.slice(0, 2)}·${canonical.slice(2, 4)}·${canonical.slice(4)}`;
}

/**
 * Schema Zod canónico para patentes chilenas. Acepta input con o sin
 * separadores, lo normaliza a 6 caracteres `[A-Z0-9]` y rechaza si la
 * estructura no matchea `[A-Z]{4}\d{2}`.
 *
 * Reemplaza el schema laxo previo que solo verificaba `min(4)` y caracteres
 * alfanuméricos — y por eso aceptaba `....`, `XXX-99`, `1234`, etc.
 */
export const chileanPlateSchema = z
  .string()
  .min(1, 'Ingresa la patente')
  .max(12, 'Patente demasiado larga')
  .transform(normalizePlate)
  .refine(
    (canonical) => CANONICAL_PLATE_RE.test(canonical),
    'Formato de patente inválido (ej: BCDF12 o AAAA12)',
  );
