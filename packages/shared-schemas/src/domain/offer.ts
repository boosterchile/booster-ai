import { z } from 'zod';
import {
  empresaIdSchema,
  offerIdSchema,
  tripRequestIdSchema,
  vehicleIdSchema,
} from '../primitives/ids.js';

/**
 * Offer = invitación enviada por el matching engine a un carrier para
 * que tome una carga.
 *
 * Lifecycle:
 *   pending → accepted | rejected | expired | superseded
 *
 *   - pending: enviada al carrier, esperando respuesta
 *   - accepted: carrier confirmó. Se crea Assignment y demás offers a
 *     otros carriers para el mismo trip_request pasan a `superseded`.
 *   - rejected: carrier respondió que no puede/no quiere
 *   - expired: TTL alcanzado sin respuesta (default 5min en piloto)
 *   - superseded: otro carrier aceptó primero — esta queda invalidada
 *
 * Constraint UNIQUE (trip_request_id, empresa_id): un mismo carrier no
 * puede recibir dos ofertas para la misma carga.
 */
export const offerStatusSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'expired',
  'superseded',
]);
export type OfferStatus = z.infer<typeof offerStatusSchema>;

export const offerResponseChannelSchema = z.enum(['web', 'whatsapp', 'api']);
export type OfferResponseChannel = z.infer<typeof offerResponseChannelSchema>;

export const offerSchema = z.object({
  id: offerIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Empresa carrier a la que se le ofreció. */
  empresa_id: empresaIdSchema,
  /**
   * Vehículo sugerido por el matching engine. El carrier puede aceptar con
   * otro vehículo si el modelo lo permite (slice 2+).
   */
  suggested_vehicle_id: vehicleIdSchema.nullable(),
  /**
   * Score del matching engine (0-1). Audit value, no se muestra al carrier.
   * Más alto = más prioridad relativa.
   */
  score: z.number().min(0).max(1),
  status: offerStatusSchema,
  /**
   * Canal por el que el carrier respondió. Útil para analytics
   * (¿es el web app o WhatsApp el canal preferido?).
   */
  response_channel: offerResponseChannelSchema.nullable(),
  /** Razón de rechazo si aplica (free text del carrier). */
  rejection_reason: z.string().nullable(),
  /**
   * Precio CLP propuesto al carrier. Slice 1: lo fija el shipper o admin.
   * Slice 2+: pricing-engine sugiere automático.
   */
  proposed_price_clp: z.number().int().nonnegative(),
  /** Cuándo se envió la oferta. */
  sent_at: z.string().datetime(),
  /** Cuándo expira si nadie responde. */
  expires_at: z.string().datetime(),
  /** Cuándo el carrier respondió (accepted | rejected). */
  responded_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Offer = z.infer<typeof offerSchema>;
