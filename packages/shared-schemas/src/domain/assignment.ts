import { z } from 'zod';
import {
  assignmentIdSchema,
  empresaIdSchema,
  offerIdSchema,
  tripRequestIdSchema,
  userIdSchema,
  vehicleIdSchema,
} from '../primitives/ids.js';

/**
 * Assignment = una carga asignada a un carrier (offer aceptada).
 *
 * Es la entidad operacional principal: cuando se vuelve `delivered` se
 * cierra el ciclo. Para el lunes piloto modelamos 4 estados core +
 * cancelled. Slice 2+ agrega substates (en_route_pickup, etc.) y disputas.
 *
 * Lifecycle:
 *   assigned → picked_up → delivered
 *           ↓             ↓
 *      cancelled      cancelled (con cargo de penalty)
 *
 *   - assigned: carrier aceptó, esperando recogida
 *   - picked_up: carrier confirmó recogida (con foto opcional)
 *   - delivered: carrier confirmó entrega (con foto + firma cliente opcional)
 *   - cancelled: alguien (carrier/shipper/admin) canceló — requiere razón
 */
export const assignmentStatusSchema = z.enum(['assigned', 'picked_up', 'delivered', 'cancelled']);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const cancellationActorSchema = z.enum(['carrier', 'shipper', 'platform_admin']);
export type CancellationActor = z.infer<typeof cancellationActorSchema>;

export const assignmentSchema = z.object({
  id: assignmentIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Offer que originó este assignment. */
  offer_id: offerIdSchema,
  /** Empresa carrier que se quedó con la carga. */
  empresa_id: empresaIdSchema,
  /** Vehículo concretamente asignado (puede diferir del suggested en offer). */
  vehicle_id: vehicleIdSchema,
  /**
   * Driver designado (membership.role='driver' del carrier). Null si el
   * carrier todavía no asignó internamente. Puede actualizarse hasta antes
   * de `picked_up`.
   */
  driver_user_id: userIdSchema.nullable(),
  status: assignmentStatusSchema,
  /** Precio acordado en la offer al momento de aceptar. Inmutable. */
  agreed_price_clp: z.number().int().nonnegative(),
  /** URL pública del comprobante de recogida (foto en Cloud Storage). */
  pickup_evidence_url: z.string().url().nullable(),
  /** URL pública del comprobante de entrega. */
  delivery_evidence_url: z.string().url().nullable(),
  /** Quién canceló (si aplica). */
  cancelled_by_actor: cancellationActorSchema.nullable(),
  /** Razón de cancelación (free text). */
  cancellation_reason: z.string().nullable(),
  accepted_at: z.string().datetime(),
  picked_up_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  cancelled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Assignment = z.infer<typeof assignmentSchema>;
