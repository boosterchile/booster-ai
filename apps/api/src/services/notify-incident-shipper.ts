/**
 * Despacha push notif (VAPID web push) al shipper cuando el conductor
 * reporta un incidente operacional durante el viaje (Phase 4 PR-K6c).
 *
 * El generador de carga recibe el aviso en su PWA aunque NO esté
 * abierta la pantalla del viaje — sirve para que reaccione (llamar al
 * conductor, ajustar expectativa de entrega) antes de que el consignee
 * se entere.
 *
 * **Reusa `sendPushToUser`** del web-push service existente. El payload
 * shape (ChatPushPayload) es genérico: title + body + tag + data.url.
 * El campo `data.message_id` lo usamos como `trip_event_id` (el
 * incidente). Igual al SW solo le importa `data.url`.
 *
 * **Tag dedupe**: `incident-${assignmentId}` — múltiples incidentes en
 * el mismo trip reemplazan (no apilan) la notif anterior. Si el
 * conductor reporta accidente y luego falla mecánica, el shipper ve la
 * última.
 *
 * **No bloquea el INSERT del trip_event**. Llamado fire-and-forget
 * desde `reportar-incidente.ts` tras el insert exitoso. Si falla, log
 * y sigue — el shipper igual puede ver el evento en el detalle del
 * trip refrescando.
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, trips } from '../db/schema.js';
import type { IncidentType } from './reportar-incidente.js';
import { type ChatPushPayload, sendPushToUser } from './web-push.js';

/**
 * Labels legibles en español para mostrar en la notif. Mirror de
 * `INCIDENT_TYPE_LABELS` del frontend (no compartido vía package
 * porque el backend nunca depende del frontend para evitar circular
 * — duplicación pequeña aceptable, 5 strings).
 */
const INCIDENT_TYPE_LABELS_ES: Record<IncidentType, string> = {
  accidente: 'Accidente',
  demora: 'Demora',
  falla_mecanica: 'Falla mecánica',
  problema_carga: 'Problema con la carga',
  otro: 'Otro incidente',
};

export interface NotifyIncidentShipperResult {
  /** True si se intentó el envío (no garantiza delivery). */
  attempted: boolean;
  /** Cantidad de subscriptions del shipper a las que se mandó. */
  sent?: number;
  /** Cuántas subscriptions quedaron invalidadas (410 Gone). */
  invalidated?: number;
  /** Razón del skip. */
  reason?: 'no_assignment' | 'no_shipper_user' | 'send_failed';
}

export async function notifyIncidentToShipper(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  tripEventId: string;
  incidentType: IncidentType;
  /** Descripción opcional del incidente (de payload.description). */
  description?: string | null;
}): Promise<NotifyIncidentShipperResult> {
  const { db, logger, assignmentId, tripEventId, incidentType, description } = opts;

  // Cargar trip + tracking_code + shipper userId en un solo round-trip.
  const rows = await db
    .select({
      tripId: assignments.tripId,
      trackingCode: trips.trackingCode,
      shipperUserId: trips.createdByUserId,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    logger.warn({ assignmentId }, 'notifyIncidentToShipper: assignment no encontrado');
    return { attempted: false, reason: 'no_assignment' };
  }

  if (!row.shipperUserId) {
    // Trips legacy / anónimos vía WhatsApp sin createdByUserId. No
    // hay a quién mandar push. Silent skip — el evento queda en el
    // trip log igual.
    logger.info(
      { assignmentId, tripEventId },
      'notifyIncidentToShipper skip — trip sin createdByUserId',
    );
    return { attempted: false, reason: 'no_shipper_user' };
  }

  const incidentLabel = INCIDENT_TYPE_LABELS_ES[incidentType];
  const title = `Incidente en ${row.trackingCode}`;
  // Body: label + opcional descripción truncada a 80 chars para no
  // overflowar el área visible de la push notif del browser.
  const body =
    description && description.trim().length > 0
      ? `${incidentLabel} · ${description.length > 80 ? `${description.slice(0, 77)}…` : description}`
      : incidentLabel;

  const payload: ChatPushPayload = {
    title,
    body,
    tag: `incident-${assignmentId}`,
    data: {
      assignment_id: assignmentId,
      // `message_id` del payload type es genérico (solo lo usa el SW
      // para deduplicate; nosotros lo apuntamos al trip_event_id para
      // que sea trazable en logs).
      message_id: tripEventId,
      url: `/app/cargas/${row.tripId}`,
    },
  };

  const result = await sendPushToUser({
    db,
    logger,
    userId: row.shipperUserId,
    payload,
  });

  logger.info(
    {
      assignmentId,
      tripEventId,
      shipperUserId: row.shipperUserId,
      sent: result.sent,
      invalidated: result.invalidated,
      errored: result.errored,
    },
    'notifyIncidentToShipper completado',
  );

  return {
    attempted: true,
    sent: result.sent,
    invalidated: result.invalidated,
    ...(result.sent === 0 && result.errored > 0 ? { reason: 'send_failed' as const } : {}),
  };
}
