import { z } from 'zod';
import { chileanPhoneSchema, rutSchema } from './primitives/chile.js';

/**
 * Schema del body PATCH /me/profile.
 *
 * Campos editables del usuario logueado. Todos opcionales — el endpoint
 * solo actualiza los presentes (parcial). Validaciones reusan los
 * primitivos de Chile cuando aplica.
 *
 * Notas:
 *   - `whatsapp_e164` es el número al que el dispatcher de notificaciones
 *     manda templates aprobados (B.8). Si está vacío, el dispatcher cae
 *     a `phone` como fallback. Para WhatsApp solo sirven celulares
 *     (+569...) — la validación pasa fijos también porque chileanPhoneSchema
 *     los acepta; runbook documenta la diferencia.
 *   - `email` no es editable acá; cambiar email requiere flow Firebase
 *     separado (verificación) que no es alcance de B.8.
 *   - `rut` solo se puede setear si todavía es null. Cambiar un RUT ya
 *     declarado requiere flow admin (no alcance de B.8).
 */
export const profileUpdateInputSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    phone: chileanPhoneSchema.optional(),
    whatsapp_e164: chileanPhoneSchema.optional(),
    rut: rutSchema.optional(),
  })
  .refine(
    (data) =>
      data.full_name !== undefined ||
      data.phone !== undefined ||
      data.whatsapp_e164 !== undefined ||
      data.rut !== undefined,
    { message: 'Al menos un campo debe estar presente' },
  );

export type ProfileUpdateInput = z.infer<typeof profileUpdateInputSchema>;
