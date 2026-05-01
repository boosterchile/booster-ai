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
 * Assignment = una carga asignada a un transportista (offer aceptada).
 *
 * Es la entidad operacional principal: cuando se vuelve `entregado` se
 * cierra el ciclo.
 *
 * Lifecycle:
 *   asignado → recogido → entregado
 *           ↓             ↓
 *      cancelado      cancelado (con cargo de penalty)
 */
export const assignmentStatusSchema = z.enum(['asignado', 'recogido', 'entregado', 'cancelado']);
export type AssignmentStatus = z.infer<typeof assignmentStatusSchema>;

export const cancellationActorSchema = z.enum([
  'transportista',
  'generador_carga',
  'admin_plataforma',
]);
export type CancellationActor = z.infer<typeof cancellationActorSchema>;

export const assignmentSchema = z.object({
  id: assignmentIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Offer que originó este assignment. */
  offer_id: offerIdSchema,
  /** Empresa transportista que se quedó con la carga. */
  empresa_id: empresaIdSchema,
  /** Vehículo concretamente asignado (puede diferir del suggested en offer). */
  vehicle_id: vehicleIdSchema,
  /**
   * Conductor designado (membership.role='conductor' del transportista).
   * Null si el transportista todavía no asignó internamente.
   */
  driver_user_id: userIdSchema.nullable(),
  status: assignmentStatusSchema,
  /** Precio acordado en la offer al momento de aceptar. Inmutable. */
  agreed_price_clp: z.number().int().nonnegative(),
  pickup_evidence_url: z.string().url().nullable(),
  delivery_evidence_url: z.string().url().nullable(),
  cancelled_by_actor: cancellationActorSchema.nullable(),
  cancellation_reason: z.string().nullable(),
  accepted_at: z.string().datetime(),
  picked_up_at: z.string().datetime().nullable(),
  delivered_at: z.string().datetime().nullable(),
  cancelled_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type Assignment = z.infer<typeof assignmentSchema>;
