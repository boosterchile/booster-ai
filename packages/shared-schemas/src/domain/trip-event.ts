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
 * Sirve como audit trail completo + fuente de verdad para reconstruir el
 * estado de un trip si Assignment se corrompe. Es append-only — nunca se
 * updatea ni borra (un trigger BEFORE UPDATE/DELETE rechaza, slice 2+).
 *
 * Naming bilingüe: los valores del enum están en español snake_case sin
 * tildes — alineados con el naming SQL de la tabla `eventos_viaje`.
 *
 * Tipos esperados:
 *   - intake_iniciado: shipper empezó a crear la carga (web/whatsapp)
 *   - intake_capturado: carga lista para matching
 *   - matching_iniciado: matching engine empezó
 *   - ofertas_enviadas: N offers enviadas a transportistas
 *   - oferta_aceptada: un transportista aceptó
 *   - oferta_rechazada: transportista rechazó
 *   - oferta_expirada: TTL expirado
 *   - asignacion_creada: assignment inicial creada
 *   - recogida_confirmada: transportista reportó recogida
 *   - entrega_confirmada: transportista reportó entrega
 *   - cancelado: alguien canceló (payload incluye actor + razón)
 *   - carbono_calculado: carbon-calculator persistió métricas en trip_metrics
 *   - certificado_emitido: certificado PDF firmado por KMS disponible
 *   - telemetria_primera_recibida: primer ping Codec8 del vehículo
 *   - telemetria_perdida: gap > umbral en pings durante el viaje
 *   - ruta_desviada: vehículo se desvió del corredor planificado
 *   - disputa_abierta: alguna parte abrió una disputa post-entrega
 */
export const tripEventTypeSchema = z.enum([
  'intake_iniciado',
  'intake_capturado',
  'matching_iniciado',
  'ofertas_enviadas',
  'oferta_aceptada',
  'oferta_rechazada',
  'oferta_expirada',
  'asignacion_creada',
  'recogida_confirmada',
  'entrega_confirmada',
  'cancelado',
  'carbono_calculado',
  'certificado_emitido',
  'telemetria_primera_recibida',
  'telemetria_perdida',
  'ruta_desviada',
  'disputa_abierta',
]);
export type TripEventType = z.infer<typeof tripEventTypeSchema>;

export const tripEventSourceSchema = z.enum(['web', 'whatsapp', 'api', 'sistema']);
export type TripEventSource = z.infer<typeof tripEventSourceSchema>;

export const tripEventSchema = z.object({
  id: tripEventIdSchema,
  trip_request_id: tripRequestIdSchema,
  /** Si el evento ocurre después de asignacion_creada, este FK existe. */
  assignment_id: assignmentIdSchema.nullable(),
  event_type: tripEventTypeSchema,
  /**
   * Payload JSON con detalles del evento. Schema específico por event_type
   * se documenta en el handler que lo emite.
   */
  payload: z.record(z.unknown()),
  source: tripEventSourceSchema,
  /**
   * Usuario que disparó el evento si aplica. Null para eventos del
   * sistema (matching automático, expiración, etc.).
   */
  recorded_by_user_id: userIdSchema.nullable(),
  recorded_at: z.string().datetime(),
});
export type TripEvent = z.infer<typeof tripEventSchema>;
