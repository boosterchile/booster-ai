import { z } from 'zod';
import { rutSchema } from './primitives/chile.js';

/**
 * @booster-ai/shared-schemas — Auth universal RUT + clave numérica
 * (ADR-035). Schemas compartidos backend ↔ frontend.
 */

/**
 * Tipos de usuario que el selector del login presenta. Determinan la
 * VISTA INICIAL post-login (no el rol del usuario). El rol viene de
 * memberships del usuario.
 */
export const userTypeHintSchema = z.enum([
  'carga', // shipper / generador de carga
  'transporte', // carrier / transportista
  'conductor',
  'stakeholder',
  'booster', // platform admin
]);
export type UserTypeHint = z.infer<typeof userTypeHintSchema>;

/**
 * Etiquetas humanas del selector de tipo de usuario.
 */
export const USER_TYPE_HINT_LABEL: Record<UserTypeHint, string> = {
  carga: 'Generador de carga',
  transporte: 'Transporte',
  conductor: 'Conductor',
  stakeholder: 'Stakeholder',
  booster: 'Booster',
};

/**
 * Clave numérica: exactamente 6 dígitos.
 */
export const claveNumericaSchema = z
  .string()
  .regex(/^\d{6}$/, 'La clave debe ser de 6 dígitos numéricos');

/**
 * Body del endpoint `POST /auth/login-rut` — login universal.
 * `tipo` es opcional; el backend no lo usa para autorización (eso viene
 * de memberships), solo lo loguea para analytics.
 */
export const loginRutSchema = z.object({
  rut: rutSchema,
  clave: claveNumericaSchema,
  tipo: userTypeHintSchema.optional(),
});
export type LoginRutInput = z.infer<typeof loginRutSchema>;

/**
 * Body para rotar la clave numérica del usuario actual.
 * Requiere conocer la clave anterior (defensa contra session hijack).
 * En el caso first-rotation (clave_numerica_hash NULL), `clave_anterior`
 * es null y el backend la acepta solo si el usuario está autenticado
 * por email/password legacy.
 */
export const rotarClaveSchema = z.object({
  clave_anterior: claveNumericaSchema.nullable(),
  clave_nueva: claveNumericaSchema,
});
export type RotarClaveInput = z.infer<typeof rotarClaveSchema>;

/**
 * Body para iniciar recovery vía WhatsApp OTP.
 */
export const requestRecoveryOtpSchema = z.object({
  rut: rutSchema,
});
export type RequestRecoveryOtpInput = z.infer<typeof requestRecoveryOtpSchema>;

/**
 * Body para verificar recovery OTP y setear nueva clave.
 */
export const verifyRecoveryOtpSchema = z.object({
  rut: rutSchema,
  otp: claveNumericaSchema, // OTP es 6 dígitos, mismo schema
  clave_nueva: claveNumericaSchema,
});
export type VerifyRecoveryOtpInput = z.infer<typeof verifyRecoveryOtpSchema>;

/**
 * Respuesta exitosa del login-rut. El cliente usa el `custom_token`
 * para `signInWithCustomToken`.
 */
export interface LoginRutSuccess {
  custom_token: string;
  synthetic_email: string;
  auth_method: 'rut_clave';
}

/**
 * Respuesta cuando el usuario aún no setea clave numérica (caso
 * migración desde email/password). El frontend redirige a UI de
 * "setear primera clave" usando el legacy password como bridge.
 */
export interface LoginRutNeedsRotation {
  error: 'needs_rotation';
  code: 'needs_rotation';
  message: string;
}
