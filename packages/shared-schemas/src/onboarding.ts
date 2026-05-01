import { z } from 'zod';
import { planSlugSchema } from './domain/plan.js';
import { chileanPhoneSchema, rutSchema } from './primitives/chile.js';
import { addressSchema } from './primitives/geo.js';

/**
 * Schema del body POST /empresas/onboarding.
 *
 * Es el primer endpoint que un user nuevo llama después de firmar en
 * Firebase Auth. Crea en una transacción atómica:
 *   1. User (con firebase_uid del Bearer token verificado)
 *   2. Empresa (con datos legales)
 *   3. Membership (role='owner', status='active') ligando ambos
 *   4. Asigna el Plan correspondiente al slug elegido
 *
 * Operación = al menos una de las dos: is_shipper o is_carrier debe ser
 * true. Una empresa que no es ni shipper ni carrier no tiene sentido.
 */
export const empresaOnboardingInputSchema = z
  .object({
    /**
     * Datos del user owner. Firebase ya tiene email + uid; aquí completa
     * full_name + phone + whatsapp_e164 (RUT opcional, lo pueden agregar
     * después). El número de WhatsApp es obligatorio porque el dispatcher
     * de notificaciones (B.8) lo usa para enviar el ping de oferta al
     * carrier — sin esto, el carrier no se entera que llegó algo y el
     * piloto pierde su valor.
     */
    user: z.object({
      full_name: z.string().min(1).max(200),
      phone: chileanPhoneSchema,
      whatsapp_e164: chileanPhoneSchema,
      rut: rutSchema.optional(),
    }),
    /** Datos legales de la empresa. */
    empresa: z.object({
      legal_name: z.string().min(1).max(200),
      rut: rutSchema,
      contact_email: z.string().email(),
      contact_phone: chileanPhoneSchema,
      address: addressSchema,
      is_shipper: z.boolean(),
      is_carrier: z.boolean(),
    }),
    /** Plan inicial. Para piloto sin billing, default 'free' aceptado. */
    plan_slug: planSlugSchema,
  })
  .refine((data) => data.empresa.is_shipper || data.empresa.is_carrier, {
    message: 'La empresa debe operar al menos como shipper o como carrier',
    path: ['empresa', 'is_shipper'],
  });

export type EmpresaOnboardingInput = z.infer<typeof empresaOnboardingInputSchema>;
