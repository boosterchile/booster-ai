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
 *   3. Membership (role='dueno', status='activa') ligando ambos
 *   4. Asigna el Plan correspondiente al slug elegido
 *
 * Operación = al menos una de las dos: is_generador_carga o is_transportista
 * debe ser true. Una empresa que no es ni una ni la otra no tiene sentido.
 */
export const empresaOnboardingInputSchema = z
  .object({
    /**
     * Datos del user dueño. Firebase ya tiene email + uid; aquí completa
     * full_name + phone + whatsapp_e164 (RUT opcional, lo pueden agregar
     * después). El número de WhatsApp es obligatorio porque el dispatcher
     * de notificaciones (B.8) lo usa para enviar el ping de oferta al
     * transportista — sin esto, el transportista no se entera que llegó
     * algo y el piloto pierde su valor.
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
      is_generador_carga: z.boolean(),
      is_transportista: z.boolean(),
    }),
    /** Plan inicial. Para piloto sin billing, default 'gratis' aceptado. */
    plan_slug: planSlugSchema,
  })
  .refine((data) => data.empresa.is_generador_carga || data.empresa.is_transportista, {
    message: 'La empresa debe operar al menos como generador de carga o como transportista',
    path: ['empresa', 'is_generador_carga'],
  });

export type EmpresaOnboardingInput = z.infer<typeof empresaOnboardingInputSchema>;
