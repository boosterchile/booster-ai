import { z } from 'zod';
import { trackingCodeSchema } from './common.js';
import { cargoTypeSchema } from './domain/cargo-request.js';
import { chileanPhoneSchema } from './primitives/chile.js';

/**
 * WhatsApp intake draft — modelo específico del thin slice (Fase 6).
 *
 * Captura los datos mínimos que el bot de WhatsApp colecta en una conversación
 * menu-driven. Esto NO es un `cargoRequest` completo (ese requiere weight, volume,
 * vehicle type, fechas estructuradas, shipper_id, etc. — ver domain/cargo-request.ts).
 *
 * Flujo previsto (slices siguientes):
 *   1. Thin slice (hoy): bot → whatsapp_intake_draft con status='captured'.
 *   2. Slice 2: background job enriquece con geocoding + NLU sobre pickup_date_raw +
 *      matching tentativo de shipper existente por phone → produce cargoRequest real.
 *   3. Slice 3: matching engine → trip.
 *
 * Mantenemos esta tabla separada de cargo_requests para no contaminar el modelo
 * canónico con drafts incompletos. Cero deuda técnica.
 */

export const whatsAppIntakeStatusSchema = z.enum([
  'in_progress', // la conversación no completó todos los prompts
  'captured', // bot persistió el draft, listo para enriquecimiento async
  'converted', // slice 2 lo convirtió a cargo_request real
  'abandoned', // user dejó de responder > TTL
  'cancelled', // user escribió "cancelar" durante la conversación
]);
export type WhatsAppIntakeStatus = z.infer<typeof whatsAppIntakeStatusSchema>;

/**
 * Input para crear un intake draft una vez que el bot completó todos los prompts.
 * Validación se ejerce en el endpoint `POST /trip-requests` del apps/api.
 */
export const whatsAppIntakeCreateInputSchema = z.object({
  shipper_whatsapp: chileanPhoneSchema,
  origin_address_raw: z.string().min(5).max(500),
  destination_address_raw: z.string().min(5).max(500),
  cargo_type: cargoTypeSchema,
  pickup_date_raw: z.string().min(1).max(200),
});
export type WhatsAppIntakeCreateInput = z.infer<typeof whatsAppIntakeCreateInputSchema>;

/**
 * Shape completo del draft — devuelto por el API al bot tras persistir.
 */
export const whatsAppIntakeSchema = z.object({
  id: z.string().uuid(),
  tracking_code: trackingCodeSchema,
  shipper_whatsapp: chileanPhoneSchema,
  origin_address_raw: z.string(),
  destination_address_raw: z.string(),
  cargo_type: cargoTypeSchema,
  pickup_date_raw: z.string(),
  status: whatsAppIntakeStatusSchema,
  created_at: z.date(),
  updated_at: z.date(),
});
export type WhatsAppIntake = z.infer<typeof whatsAppIntakeSchema>;
