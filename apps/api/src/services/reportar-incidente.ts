/**
 * Reporta un incidente operacional durante un viaje (Phase 4 PR-K6).
 *
 * El conductor (vía voice command "marcar incidente" o botón) puede
 * reportar:
 *   - accidente: choque, golpe, daño al vehículo
 *   - demora: retraso significativo (tráfico, ruta cerrada)
 *   - falla_mecanica: pinchazo, motor, frenos
 *   - problema_carga: rotura, derrame, contaminación
 *   - otro: catch-all con descripción libre
 *
 * **Persistencia**: insert único en `trip_events` con
 * `event_type='incidente_reportado'` y payload con subtipo +
 * descripción + actor. NO crea row separada — los incidents son
 * eventos del trip, audit-only, no estado mutable.
 *
 * **Notificación al shipper**: TODO PR-K6b — disparar push notif al
 * shipper user (web push si suscrito). Por ahora solo log para que
 * un admin lo vea y avise manualmente si crítico.
 *
 * **NO bloquea el lifecycle del viaje**: el incidente es informativo.
 * El conductor sigue con el viaje normal; si quiere cancelar, hay un
 * flujo separado (PATCH /trip-requests-v2/:id/cancelar). Esta
 * separación evita reportes accidentales de "cancelar todo".
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripEvents } from '../db/schema.js';

export const INCIDENT_TYPES = [
  'accidente',
  'demora',
  'falla_mecanica',
  'problema_carga',
  'otro',
] as const;

export type IncidentType = (typeof INCIDENT_TYPES)[number];

export interface ReportarIncidenteInput {
  /** Tipo del incidente. Validado por el caller (zod en route). */
  incidentType: IncidentType;
  /** Descripción libre opcional, max 1000 chars. */
  description?: string;
  /** Quién reporta — actor para audit. */
  actor: {
    empresaId: string;
    userId: string;
  };
}

export type ReportarIncidenteResult =
  | { ok: true; tripEventId: string; recordedAt: Date }
  | {
      ok: false;
      code: 'assignment_not_found' | 'forbidden_owner_mismatch';
    };

export async function reportarIncidente(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  input: ReportarIncidenteInput;
}): Promise<ReportarIncidenteResult> {
  const { db, logger, assignmentId, input } = opts;

  // Validar que el assignment existe + pertenece a la empresa del actor.
  // Defensa-en-profundidad: el route layer ya valida auth, pero el
  // service no asume nada (testeable independientemente).
  const rows = await db
    .select({
      id: assignments.id,
      tripId: assignments.tripId,
      empresaId: assignments.empresaId,
    })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, code: 'assignment_not_found' };
  }
  if (row.empresaId !== input.actor.empresaId) {
    return { ok: false, code: 'forbidden_owner_mismatch' };
  }

  // Insert el evento. tripEventSourceEnum acepta 'web' | 'whatsapp' |
  // 'api' | 'sistema'. Origen desde la PWA = 'web'.
  const [evt] = await db
    .insert(tripEvents)
    .values({
      tripId: row.tripId,
      assignmentId: row.id,
      eventType: 'incidente_reportado',
      source: 'web',
      payload: {
        incident_type: input.incidentType,
        description: input.description ?? null,
        actor_empresa_id: input.actor.empresaId,
        actor_user_id: input.actor.userId,
        reported_via: 'pwa', // Future: 'voice' | 'button'
      },
      recordedByUserId: input.actor.userId,
    })
    .returning({ id: tripEvents.id, recordedAt: tripEvents.recordedAt });

  if (!evt) {
    throw new Error('insert tripEvents returned no row');
  }

  logger.info(
    {
      tripEventId: evt.id,
      assignmentId,
      tripId: row.tripId,
      incidentType: input.incidentType,
      actorUserId: input.actor.userId,
    },
    'incidente reportado',
  );

  return { ok: true, tripEventId: evt.id, recordedAt: evt.recordedAt };
}

/**
 * Validador para `assertIncidentType` — type guard. Útil en el route
 * layer si no se usa zod directamente.
 */
export function isIncidentType(value: unknown): value is IncidentType {
  return typeof value === 'string' && (INCIDENT_TYPES as readonly string[]).includes(value);
}
