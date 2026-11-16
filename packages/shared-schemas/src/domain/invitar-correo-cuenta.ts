import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { MENSAJES } from '../primitives/mensajes.js';

/**
 * Invitación por correo + UI de creación de cuenta para personal Booster
 * (y stakeholders en el mismo contrato) — ADR-093 /
 * `.specs/auth-correo-clave-booster-stakeholder`.
 *
 * El admin invita solo con el correo. La persona consigna nombre, RUT (si
 * aplica) y clave Firebase en `/crear-cuenta`. Login canónico: correo + clave
 * con tipo `booster` o `stakeholder`. Generador/transportista/conductor no
 * cambian (siguen RUT + clave numérica, ADR-035).
 */

/** Tipos de invitación que consumen la UI de creación. */
export const tipoInvitacionCorreoCuentaSchema = z.enum(['personal_booster', 'stakeholder']);
export type TipoInvitacionCorreoCuenta = z.infer<typeof tipoInvitacionCorreoCuentaSchema>;

/** Vigencia del enlace de creación (7 días), alineada al código de activación. */
export const INVITACION_CORREO_CUENTA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Clave Firebase (no clave numérica de 6 dígitos). Mínimo 8 caracteres;
 * Firebase acepta desde 6, pero el producto evita confusión con el PIN.
 */
export const CLAVE_FIREBASE_MIN = 8;
export const CLAVE_FIREBASE_MAX = 128;

const emailInvitacionSchema = z
  .string({ error: MENSAJES.requerido })
  .trim()
  .toLowerCase()
  .email(MENSAJES.correo)
  .max(255, MENSAJES.max(255));

/**
 * Body de `POST /admin/personal-booster/invitar` — usuario nuevo del personal.
 * Solo el correo; nombre/RUT/clave los consigna la persona en la UI.
 */
export const invitarPersonalBoosterCorreoSchema = z.object({
  email: emailInvitacionSchema,
});
export type InvitarPersonalBoosterCorreoInput = z.input<typeof invitarPersonalBoosterCorreoSchema>;
export type InvitarPersonalBoosterCorreo = z.infer<typeof invitarPersonalBoosterCorreoSchema>;

/**
 * Respuesta del invite. Sin token en claro ni clave: el enlace solo viaja
 * en el correo From `contacto@`.
 */
export const invitarPersonalBoosterCorreoResponseSchema = z.object({
  ok: z.literal(true),
  invitacion_id: z.string().uuid(),
  email: z.string().email(),
  expira_en: z.string().datetime(),
});
export type InvitarPersonalBoosterCorreoResponse = z.infer<
  typeof invitarPersonalBoosterCorreoResponseSchema
>;

/** Token opaco en query/body (base64url, sin secretos en logs). */
export const tokenInvitacionCorreoSchema = z
  .string({ error: MENSAJES.requerido })
  .trim()
  .min(32, MENSAJES.min(32))
  .max(128, MENSAJES.max(128));

/**
 * `GET /auth/invitar-cuenta?token=` → 200 con el correo precargado (no
 * editable en la UI). Uniforme 410 si inválido/vencido/consumido.
 */
export const consultarInvitacionCorreoResponseSchema = z.object({
  email: z.string().email(),
  tipo: tipoInvitacionCorreoCuentaSchema,
  expira_en: z.string().datetime(),
});
export type ConsultarInvitacionCorreoResponse = z.infer<
  typeof consultarInvitacionCorreoResponseSchema
>;

const claveFirebaseSchema = z
  .string({ error: MENSAJES.requerido })
  .min(CLAVE_FIREBASE_MIN, MENSAJES.min(CLAVE_FIREBASE_MIN))
  .max(CLAVE_FIREBASE_MAX, MENSAJES.max(CLAVE_FIREBASE_MAX))
  .refine((v) => !/^\d{6}$/.test(v), {
    message: 'La clave no puede ser solo 6 dígitos; usa una contraseña distinta',
  });

/**
 * Body de `POST /auth/invitar-cuenta`. El correo viene de la invitación
 * (token); no se acepta otro. RUT obligatorio para personal Booster.
 */
export const crearCuentaInvitacionSchema = z
  .object({
    token: tokenInvitacionCorreoSchema,
    full_name: z
      .string({ error: MENSAJES.requerido })
      .trim()
      .min(2, MENSAJES.min(2))
      .max(200, MENSAJES.max(200)),
    password: claveFirebaseSchema,
    password_confirm: z.string({ error: MENSAJES.requerido }),
    rut: rutSchema,
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.password_confirm) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password_confirm'],
        message: 'Las claves no coinciden',
      });
    }
  });
export type CrearCuentaInvitacionInput = z.input<typeof crearCuentaInvitacionSchema>;
export type CrearCuentaInvitacion = z.infer<typeof crearCuentaInvitacionSchema>;

/**
 * `POST /auth/invitar-cuenta` → 201. `custom_token` permite iniciar sesión
 * sin re-pedir la clave; si falta, la UI manda a `/login?tipo=booster`.
 */
export const crearCuentaInvitacionResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string().uuid(),
  email: z.string().email(),
  tipo: tipoInvitacionCorreoCuentaSchema,
  custom_token: z.string().min(1).nullable(),
});
export type CrearCuentaInvitacionResponse = z.infer<typeof crearCuentaInvitacionResponseSchema>;

/**
 * Códigos de error del flujo de invitación/creación (campo `code`):
 *   - 409 `email_already_registered`: ya hay cuenta con ese correo.
 *   - 409 `rut_already_registered`: el RUT es de otra persona.
 *   - 410 `invitacion_invalida`: token inválido, vencido o ya consumido.
 *   - 404 `invitacion_not_found`: alias uniforme del 410 en algunos callers.
 */
export const invitacionCorreoCuentaErrorCodeSchema = z.enum([
  'email_already_registered',
  'rut_already_registered',
  'invitacion_invalida',
  'invitacion_not_found',
]);
export type InvitacionCorreoCuentaErrorCode = z.infer<typeof invitacionCorreoCuentaErrorCodeSchema>;
