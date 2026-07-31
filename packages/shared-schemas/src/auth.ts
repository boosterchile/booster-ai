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

// ---------------------------------------------------------------------------
// equipo-de-la-empresa — la empresa da de alta a su propia gente
// ---------------------------------------------------------------------------

/**
 * Roles que una empresa puede asignar al sumar a alguien de su equipo.
 *
 * Excluye dos del enum de `membresias.rol`:
 *   - `conductor`: tiene su propia alta, que además captura licencia y
 *     vencimientos (`POST /conductores`).
 *   - `stakeholder_sostenibilidad`: pertenece a organizaciones stakeholder
 *     (ADR-034), no a empresas — el CHECK XOR de la BD lo impide.
 */
export const rolEquipoSchema = z.enum(['dueno', 'admin', 'despachador', 'visualizador']);
export type RolEquipo = z.infer<typeof rolEquipoSchema>;

/**
 * Alta de un miembro del equipo, hecha por el dueño o admin de la empresa.
 *
 * El `email` es **obligatorio**: es el canal de comunicación de la plataforma
 * con esa persona (spec `equipo-de-la-empresa` §6.1). Hacerlo opcional es el
 * defecto que arrastra el alta de conductores, donde se termina creando gente
 * con un correo `@boosterchile.invalid` a la que nadie puede escribirle.
 *
 * Ojo con lo que NO está acá: la credencial. La empresa no elige la clave de
 * su gente — solo entrega un código de activación de un solo uso.
 */
export const invitarMiembroSchema = z.object({
  full_name: z.string().min(2).max(200),
  rut: rutSchema,
  email: z.string().email().max(320),
  rol: rolEquipoSchema,
});
export type InvitarMiembroInput = z.infer<typeof invitarMiembroSchema>;

/**
 * Activación de una cuenta creada por la empresa: la persona prueba identidad
 * con el código que le entregaron y, en el mismo acto, **elige su clave**.
 *
 * El código sirve una vez y no queda como contraseña (spec §6.1): esa
 * distinción es la diferencia con el flujo de conductores actual, donde el PIN
 * que genera el admin termina siendo la credencial permanente.
 */
export const activarCuentaSchema = z.object({
  rut: rutSchema,
  codigo: z.string().regex(/^\d{6}$/, 'El código es de 6 dígitos'),
  clave_numerica: claveNumericaSchema,
});
export type ActivarCuentaInput = z.infer<typeof activarCuentaSchema>;
