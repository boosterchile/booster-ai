import { z } from 'zod';
import { ApiError } from './api-client.js';

/**
 * Helpers compartidos de validación de forms.
 *
 * Nacen de la regla de tres: el shape de error 400 de `@hono/zod-validator`
 * y la validación client-side de rangos numéricos estaban duplicados (o
 * ausentes) en `solicitar-acceso.tsx`, `vehiculos.tsx` (PR #650) y
 * `sucursales.tsx`. Ver `.specs/fix-sucursales-form-validacion/spec.md`.
 *
 * Contexto: los forms del repo declaran `noValidate` (los mensajes nativos
 * del browser no localizan bien), así que los attributes HTML5
 * `min`/`max`/`required` de los inputs NO bloquean el submit — son solo
 * afford visual de los steppers. Cada form debe validar en su `submit()`
 * con `numericFieldError` y mapear el 400 del server con
 * `serverValidationFieldsMessage` (defense in depth, no reemplazo).
 */

/**
 * Regla de rango para un campo numérico de form (los valores de
 * react-hook-form son strings). Espejo client-side del schema Zod del API
 * correspondiente — el server sigue siendo la fuente de verdad.
 */
export interface NumericFieldRule {
  min: number;
  max: number;
  /** `true` exige entero (Number.isInteger). */
  entero: boolean;
  /**
   * Mensaje cuando el campo viene vacío. Si se omite, vacío es válido
   * (campo opcional).
   */
  requiredMessage?: string;
}

/**
 * Valida un valor crudo de input contra una regla. Devuelve el mensaje de
 * error en español, o `null` si el valor es válido.
 */
export function numericFieldError(rule: NumericFieldRule, raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return rule.requiredMessage ?? null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    // Inalcanzable vía inputs type=number (la sanitización WHATWG vacía a ''
    // todo string cuyo parse no dé un finito — jsdom y browsers reales por
    // igual), pero sin esta guardia un caller que pase strings crudos dejaría
    // colar NaN: NaN < min y NaN > max son ambos false y "pasaría" el rango.
    return 'Número inválido';
  }
  if (rule.entero && !Number.isInteger(value)) {
    return 'Debe ser un número entero';
  }
  if (value < rule.min || value > rule.max) {
    // `es-CL` para separador de miles (100.000) y coma decimal (99,99).
    return `Debe estar entre ${rule.min.toLocaleString('es-CL')} y ${rule.max.toLocaleString('es-CL')}`;
  }
  return null;
}

/**
 * Shape 400/422 de `zValidator('json', …)` sin hook custom (default de
 * `@hono/zod-validator@0.7.6`): `c.json({ success: false, error: <ZodError> })`
 * donde `ZodError` serializa (JSON.stringify de sus propiedades propias
 * enumerables) como `{ issues: [{ path, message, code, … }], name }` —
 * `message` es un getter de prototipo y NO sobrevive el stringify. Solo se
 * valida el subset que se necesita (`path`); el `message`/`code` del issue
 * se ignoran a propósito (vienen en inglés, default de zod sin locale).
 * Shape verificado empíricamente contra `apps/api` en `solicitar-acceso.tsx`.
 */
const zValidatorErrorPayloadSchema = z.object({
  success: z.literal(false),
  error: z.object({
    issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })),
  }),
});

/**
 * Extrae los `path` de los issues de un error 400/422 de zValidator.
 * `null` cuando `err` no es un `ApiError` de esos status o `err.details`
 * no calza con el shape (drift del backend) — el caller decide su fallback
 * y nunca se inventa contenido sobre un shape desconocido.
 */
export function zValidatorIssuePaths(
  err: unknown,
): ReadonlyArray<ReadonlyArray<string | number>> | null {
  if (!(err instanceof ApiError) || (err.status !== 400 && err.status !== 422)) {
    return null;
  }
  const parsed = zValidatorErrorPayloadSchema.safeParse(err.details);
  if (!parsed.success) {
    return null;
  }
  return parsed.data.error.issues.map((issue) => issue.path);
}

/**
 * Mensaje de banner legible para un 400/422 de validación del server,
 * nombrando los campos afectados según `fieldLabels` (path[0] → label en
 * español). `null` si el error no trae shape zValidator o ningún path mapea
 * a un campo conocido — el caller conserva su mensaje original.
 */
export function serverValidationFieldsMessage(
  err: unknown,
  fieldLabels: Record<string, string>,
): string | null {
  const paths = zValidatorIssuePaths(err);
  if (!paths) {
    return null;
  }
  const labels = [
    ...new Set(
      paths
        .map((path) => fieldLabels[String(path[0] ?? '')])
        .filter((label): label is string => label !== undefined),
    ),
  ];
  if (labels.length === 0) {
    return null;
  }
  return `Revisa los campos: ${labels.join(', ')} — el servidor rechazó sus valores.`;
}
