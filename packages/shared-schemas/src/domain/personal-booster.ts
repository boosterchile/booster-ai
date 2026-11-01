import { z } from 'zod';
import { rutSchema } from '../primitives/chile.js';

/**
 * Alta del personal de Booster desde el panel de administración
 * (`.specs/alta-personal-booster/spec.md` §4).
 *
 * La lista de Terraform (`BOOSTER_PLATFORM_ADMIN_EMAILS`) sigue decidiendo
 * quién entra al panel. El alta crea la cuenta provisoria y entrega un código
 * de un solo uso; la persona elige su propia clave en `/activar`. El orden es
 * alta en el panel → el PO agrega el correo a la lista → la persona activa.
 */

/** Código de activación de 6 dígitos. Solo viaja en la respuesta que lo emite. */
const codigoActivacionSchema = z.string().regex(/^\d{6}$/);

/**
 * Body de `POST /admin/personal-booster`. El correo se normaliza a minúsculas
 * (la lista de Terraform se compara en minúsculas) y el RUT a su forma
 * canónica `12345678-K` con el dígito verificador validado.
 */
export const altaPersonalBoosterSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  full_name: z.string().trim().min(2).max(200),
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
  /** El correo está en `BOOSTER_PLATFORM_ADMIN_EMAILS`. */
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
 *   - `cuenta_activa`: ya tenía clave; sin código. Se marca como personal
 *     solo si el correo está en la lista.
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
 * Códigos de error de las rutas del personal (campo `code` de la respuesta):
 *   - 409 `rut_mismatch`: el correo es de una cuenta con otro RUT (o sin RUT).
 *   - 409 `rut_already_registered`: el RUT es de otra persona.
 *   - 409 `email_already_registered`: otra cuenta tomó el correo durante el alta.
 *   - 409 `already_activated`: la cuenta ya eligió su clave; no se re-emite.
 *   - 404 `personal_not_found`: el usuario no existe o no es del personal.
 */
export const personalBoosterErrorCodeSchema = z.enum([
  'rut_mismatch',
  'rut_already_registered',
  'email_already_registered',
  'already_activated',
  'personal_not_found',
]);
export type PersonalBoosterErrorCode = z.infer<typeof personalBoosterErrorCodeSchema>;
