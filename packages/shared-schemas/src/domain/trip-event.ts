import { z } from 'zod';
import {
  assignmentIdSchema,
  tripEventIdSchema,
  tripRequestIdSchema,
  userIdSchema,
} from '../primitives/ids.js';

/**
 * TripEvent = log inmutable de eventos del lifecycle de un trip.
 *
 * Sirve como audit trail completo + fuente de verdad para reconstruir
 * el estado de un trip si Assignment se corrompe. Es append-only —
 * nunca se updatea ni borra (esto se enforza a nivel DB con un trigger
 * BEFORE UPDATE/DELETE que rechaza, slice 2+).
 *
 * Tipos de eventos esperados (slice 1):
 *   - intake_started: shipper empezó a crear la carga (WhatsApp/web)
 *   - intake_captured: carga lista para matching
 *   - matching_started: matching engine empezó
 *   - offers_sent: N offers enviadas a carriers (payload incluye carrier_ids)
 *   - offer_accepted: un carrier aceptó (payload incluye offer_id, carrier_id)
 *   - offer_rejected: carrier rechazó
 *   - offer_expired: TTL expirado
 *   - assignment_created: assignment inicial creada
 *   - pickup_confirmed: carrier reportó recogida
 *   - delivery_confirmed: carrier reportó entrega
 *   - cancelled: alguien canceló (payload incluye actor + reason)
 *   - dispute_opened (slice 2+)
 */
export const tripEventTypeSchema = z.enum([
  'intake_started',
  'intake_captured',
  'matching_started',
  'offers_sent',
  'offer_accepted',
  'offer_rejected',
  'offer_expired',
  'assignment_created',
  'pickup_confirmed',
  'delivery_confirmed',
  'cancelled',
]);
export type TripEventType = z.infer<typeof tripEventTypeSchema>;

export const tripEventSourceSchema = z.enum([
  'web', // Vino desde apps/web
  'whatsapp', // Vino desde el bot WhatsApp
  'api', // API externa (futuro)
  'system', // Generado por algún job/scheduler interno
]);
export type TripEventSource = z.infer<typeof tripEventSourceSchema>;

export const tripEventSchema = z.object({
  id: tripEventIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Si el evento ocurre después de assignment_created, este FK existe. */
  assignment_id: assignmentIdSchema.nullable(),
  event_type: tripEventTypeSchema,
  /**
   * Payload JSON con detalles del evento (qué cambió, valores, urls, etc.).
   * Schema específico por event_type se documenta en el handler que lo emite.
   */
  payload: z.record(z.unknown()),
  source: tripEventSourceSchema,
  /**
   * Usuario que disparó el evento si aplica. Null para eventos del sistema
   * (matching automático, expiración, etc.).
   */
  recorded_by_user_id: userIdSchema.nullable(),
  recorded_at: z.string().datetime(),
});
export type TripEvent = z.infer<typeof tripEventSchema>;
