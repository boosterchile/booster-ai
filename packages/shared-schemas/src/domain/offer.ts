import { z } from 'zod';
import {
  empresaIdSchema,
  offerIdSchema,
  tripRequestIdSchema,
  vehicleIdSchema,
} from '../primitives/ids.js';

/**
 * Offer = invitación enviada por el matching engine a un transportista
 * para que tome una carga.
 *
 * Lifecycle:
 *   pendiente → aceptada | rechazada | expirada | reemplazada
 *
 * Constraint UNIQUE (trip_request_id, empresa_id): un mismo transportista
 * no puede recibir dos ofertas para la misma carga.
 */
export const offerStatusSchema = z.enum([
  'pendiente',
  'aceptada',
  'rechazada',
  'expirada',
  'reemplazada',
]);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

export const offerResponseChannelSchema = z.enum(['web', 'whatsapp', 'api']);
export type OfferResponseChannel = z.infer<typeof offerResponseChannelSchema>;

export const offerSchema = z.object({
  id: offerIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Empresa transportista a la que se le ofreció. */
  empresa_id: empresaIdSchema,
  /**
   * Vehículo sugerido por el matching engine. El transportista puede
   * aceptar con otro vehículo si el modelo lo permite (slice 2+).
   */
  suggested_vehicle_id: vehicleIdSchema.nullable(),
  /**
   * Score del matching engine (0-1). Audit value, no se muestra al
   * transportista. Más alto = más prioridad relativa.
   */
  score: z.number().min(0).max(1),
  status: offerStatusSchema,
  response_channel: offerResponseChannelSchema.nullable(),
  rejection_reason: z.string().nullable(),
  proposed_price_clp: z.number().int().nonnegative(),
  sent_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  responded_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Offer = z.infer<typeof offerSchema>;
