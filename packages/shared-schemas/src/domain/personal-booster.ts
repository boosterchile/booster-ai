import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';
import { MENSAJES } from '../primitives/mensajes.js';

/**
 * Alta del personal de Booster desde el panel de administración
 * (`.specs/alta-personal-booster/spec.md` §4 y
 * `.specs/acceso-panel-plataforma/spec.md` §4).
 *
 * El panel otorga y quita el acceso: el alta marca la cuenta como personal y,
 * si no tiene clave, entrega un código de un solo uso; la persona elige su
 * propia clave en `/activar`. La lista de Terraform
 * (`BOOSTER_PLATFORM_ADMIN_EMAILS`) queda como respaldo para el primer admin.
 */

/** Código de activación de 6 dígitos. Solo viaja en la respuesta que lo emite. */
const codigoActivacionSchema = z.string().regex(/^\d{6}$/);

/**
 * Body de `POST /admin/personal-booster`. El correo se normaliza a minúsculas
 * (la lista de Terraform se compara en minúsculas) y el RUT a su forma
 * canónica `12345678-K` con el dígito verificador validado. Los mensajes son
 * los de `MENSAJES`; se arman aquí porque el recorte va antes de validar.
 */
export const altaPersonalBoosterSchema = z.object({
  email: z
    .string({ error: MENSAJES.requerido })
    .trim()
    .toLowerCase()
    .email(MENSAJES.correo)
    .max(255, MENSAJES.max(255)),
  full_name: z
    .string({ error: MENSAJES.requerido })
    .trim()
    .min(2, MENSAJES.min(2))
    .max(200, MENSAJES.max(200)),
  rut: rutSchema,
});
export type AltaPersonalBoosterInput = z.input<typeof altaPersonalBoosterSchema>;
export type AltaPersonalBooster = z.infer<typeof altaPersonalBoosterSchema>;

/**
 * Estado de una persona del personal tal como la ve el panel:
 *   - `sin_cuenta`: el correo está en la lista de Terraform y no hay cuenta.
 *   - `pendiente_activacion`: cuenta provisoria, todavía sin clave propia.
 *   - `activa`: la persona ya eligió su clave.
 */
export const personalBoosterEstadoSchema = z.enum(['sin_cuenta', 'pendiente_activacion', 'activa']);
export type PersonalBoosterEstado = z.infer<typeof personalBoosterEstadoSchema>;

/** Ítem de `GET /admin/personal-booster`. Nunca trae el código. */
export const personalBoosterSchema = z.object({
  email: z.string(),
  /** El correo está en la lista de respaldo `BOOSTER_PLATFORM_ADMIN_EMAILS`. */
  en_lista: z.boolean(),
  user_id: z.string().uuid().nullable(),
  nombre: z.string().nullable(),
  rut: z.string().nullable(),
  estado: personalBoosterEstadoSchema,
  /** Vencimiento del código pendiente; null si no hay o si la cuenta está activa. */
  expira_en: z.string().datetime().nullable(),
  /** Último ingreso; solo para cuentas activas. */
  ultimo_login_en: z.string().datetime().nullable(),
});
export type PersonalBooster = z.infer<typeof personalBoosterSchema>;

/** `GET /admin/personal-booster` → 200. Ordenado por correo. */
export const listaPersonalBoosterResponseSchema = z.object({
  personal: z.array(personalBoosterSchema),
});
export type ListaPersonalBoosterResponse = z.infer<typeof listaPersonalBoosterResponseSchema>;

/**
 * Qué encontró el alta en `usuarios`:
 *   - `nueva`: no existía; se creó la cuenta provisoria con su código.
 *   - `cuenta_activa`: ya tenía clave; sin código. Queda marcada como
 *     personal, con acceso desde ese momento.
 *   - `codigo_vigente`: provisoria con un código vigente emitido desde el
 *     panel; se conserva.
 *   - `provisoria_sin_codigo`: provisoria sin un código vigente del panel: se
 *     emitió uno nuevo.
 */
export const vinculoPersonalBoosterSchema = z.enum([
  'nueva',
  'cuenta_activa',
  'codigo_vigente',
  'provisoria_sin_codigo',
]);
export type VinculoPersonalBooster = z.infer<typeof vinculoPersonalBoosterSchema>;

/** Vínculos en los que el alta emite un código nuevo. */
const VINCULOS_CON_CODIGO: ReadonlySet<VinculoPersonalBooster> = new Set([
  'nueva',
  'provisoria_sin_codigo',
]);

/**
 * `POST /admin/personal-booster` → 201 si creó la cuenta (`vinculo: nueva`),
 * 200 si la persona ya existía. `codigo_activacion` viene solo cuando se
 * emitió en esta llamada; `expira_en` es el vencimiento del código pendiente.
 */
export const altaPersonalBoosterResponseSchema = z
  .object({
    ok: z.literal(true),
    user_id: z.string().uuid(),
    vinculo: vinculoPersonalBoosterSchema,
    codigo_activacion: codigoActivacionSchema.nullable(),
    expira_en: z.string().datetime().nullable(),
    en_lista: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const debeTraerCodigo = VINCULOS_CON_CODIGO.has(data.vinculo);
    if (debeTraerCodigo && (data.codigo_activacion === null || data.expira_en === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['codigo_activacion'],
        message: 'El vínculo emite un código: deben venir el código y su vencimiento',
      });
    }
    if (!debeTraerCodigo && data.codigo_activacion !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['codigo_activacion'],
        message: 'Este vínculo no emite código',
      });
    }
    if (data.vinculo === 'cuenta_activa' && data.expira_en !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expira_en'],
        message: 'Una cuenta activa no tiene código pendiente',
      });
    }
  });
export type AltaPersonalBoosterResponse = z.infer<typeof altaPersonalBoosterResponseSchema>;

/**
 * `POST /admin/personal-booster/:userId/codigo` (sin body) → 200. El código
 * anterior deja de servir y el plazo de 7 días corre desde la re-emisión.
 */
export const reemitirCodigoPersonalBoosterResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string().uuid(),
  codigo_activacion: codigoActivacionSchema,
  expira_en: z.string().datetime(),
  en_lista: z.boolean(),
});
export type ReemitirCodigoPersonalBoosterResponse = z.infer<
  typeof reemitirCodigoPersonalBoosterResponseSchema
>;

/**
 * `POST /admin/personal-booster/:userId/quitar-acceso` (sin body) → 200. La
 * cuenta deja de estar marcada como personal (`.specs/acceso-panel-plataforma`
 * SC4).
 */
export const quitarAccesoPersonalBoosterResponseSchema = z.object({
  ok: z.literal(true),
  user_id: z.string().uuid(),
});
export type QuitarAccesoPersonalBoosterResponse = z.infer<
  typeof quitarAccesoPersonalBoosterResponseSchema
>;

/**
 * Códigos de error de las rutas del personal (campo `code` de la respuesta):
 *   - 409 `rut_mismatch`: el correo es de una cuenta con otro RUT (o sin RUT).
 *   - 409 `rut_already_registered`: el RUT es de otra persona.
 *   - 409 `email_already_registered`: otra cuenta tomó el correo durante el alta.
 *   - 409 `already_activated`: la cuenta ya eligió su clave; no se re-emite.
 *   - 404 `personal_not_found`: el usuario no existe o no es del personal.
 *   - 409 `en_lista_respaldo`: el correo está en la lista de respaldo; ese
 *     acceso se quita en Terraform, no desde el panel.
 *   - 409 `ultimo_acceso`: quitarlo dejaría el panel sin nadie con acceso.
 */
export const personalBoosterErrorCodeSchema = z.enum([
  'rut_mismatch',
  'rut_already_registered',
  'email_already_registered',
  'already_activated',
  'personal_not_found',
  'en_lista_respaldo',
  'ultimo_acceso',
]);
export type PersonalBoosterErrorCode = z.infer<typeof personalBoosterErrorCodeSchema>;

/**
 * Las cuentas del personal se gestionan solo desde Booster
 * (`.specs/acceso-panel-plataforma` SC7 y SC8). Los flujos de empresa
 * (conductores y equipo) responden 409 con este código cuando la cuenta está
 * marcada como personal o su correo, actual o nuevo, está en la lista de
 * respaldo. La web muestra el mensaje.
 */
export const CODIGO_CUENTA_PERSONAL_BOOSTER = 'cuenta_personal_booster' as const;
export const MENSAJE_CUENTA_PERSONAL_BOOSTER =
  'Esta persona es del personal de Booster; su cuenta se gestiona desde Booster.';
