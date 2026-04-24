import { z } from 'zod';

/**
 * Validación RUT chileno. Formato: 12345678-9 o 12.345.678-9
 * Incluye verificación del dígito verificador.
 */
export const rutSchema = z
  .string()
  .regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]$/, 'RUT con formato inválido')
  .refine(validateRutCheckDigit, 'Dígito verificador de RUT inválido');

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
