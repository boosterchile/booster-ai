import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conductorDeAsignacion } from '../db/configuracion-de-asignacion.js';
import { assignments, tripChangeRequests } from '../db/schema.js';
import { notifyCambioCarga } from './notify-cambio-carga.js';

/**
 * Recordatorios de solicitudes de cambio sin responder (editar-anular-cargas
 * §6.14, §8). Toma las pendientes cuyo último aviso (o su creación) es más
 * viejo que el intervalo, con `FOR UPDATE SKIP LOCKED` para que dos corridas
 * del job no tomen la misma, y en la misma tx deja `ultimo_recordatorio_en`
 * y `recordatorios_enviados` al día. Después del commit avisa a la oficina
 * de la transportista. Paran solos cuando la solicitud se cierra.
 *
 * Es cross-empresa por diseño (un job de plataforma).
 */

const TOPE_POR_CORRIDA = 200;

export interface ResultadoRecordatorios {
  recordados: number;
  fallidos: number;
}

export async function recordarSolicitudesCambio(deps: {
  db: Db;
  logger: Logger;
  intervaloMin: number;
  /** Inyectable para tests; por defecto el push de `notify-cambio-carga`. */
  avisar?: typeof notifyCambioCarga;
}): Promise<ResultadoRecordatorios> {
  const { db, logger, intervaloMin } = deps;
  const avisar = deps.avisar ?? notifyCambioCarga;

  const tomadas = await db.transaction(async (tx) => {
    // rls-allowlist: job de plataforma cross-empresa (§6.14); solo lee solicitudes pendientes.
    const filas = await tx
      .select({ id: tripChangeRequests.id })
      .from(tripChangeRequests)
      .where(
        and(
          eq(tripChangeRequests.status, 'pendiente'),
          sql`coalesce(${tripChangeRequests.lastReminderAt}, ${tripChangeRequests.createdAt}) < now() - make_interval(mins => ${intervaloMin})`,
        ),
      )
      .orderBy(tripChangeRequests.createdAt)
      .limit(TOPE_POR_CORRIDA)
      .for('update', { skipLocked: true });
    if (filas.length === 0) {
      return [];
    }
    const ids = filas.map((f) => f.id);
    // rls-allowlist: job de plataforma cross-empresa (§6.14); marca las filas bloqueadas arriba.
    return await tx
      .update(tripChangeRequests)
      .set({
        lastReminderAt: sql`now()`,
        remindersSent: sql`${tripChangeRequests.remindersSent} + 1`,
      })
      .where(and(inArray(tripChangeRequests.id, ids), eq(tripChangeRequests.status, 'pendiente')))
      .returning({
        id: tripChangeRequests.id,
        tripId: tripChangeRequests.tripId,
        assignmentId: tripChangeRequests.assignmentId,
      });
  });
  if (tomadas.length === 0) {
    return { recordados: 0, fallidos: 0 };
  }

  // rls-allowlist: job de plataforma cross-empresa (§6.14); asignaciones de las solicitudes tomadas.
  const asignaciones = await db
    .select({
      id: assignments.id,
      empresaId: assignments.empresaId,
      driverUserId: conductorDeAsignacion,
    })
    .from(assignments)
    .where(
      inArray(
        assignments.id,
        tomadas.map((t) => t.assignmentId),
      ),
    );
  const porId = new Map(asignaciones.map((a) => [a.id, a]));

  let recordados = 0;
  let fallidos = 0;
  for (const t of tomadas) {
    const asignacion = porId.get(t.assignmentId);
    if (!asignacion) {
      fallidos += 1;
      logger.error(
        { solicitudId: t.id, assignmentId: t.assignmentId },
        'recordatorio de cambio: la solicitud apunta a una asignación inexistente',
      );
      continue;
    }
    try {
      await avisar({ db, logger }, { tripId: t.tripId, asignacion, evento: 'cambio_recordatorio' });
      recordados += 1;
    } catch (err) {
      fallidos += 1;
      logger.warn({ err, solicitudId: t.id, tripId: t.tripId }, 'recordatorio de cambio falló');
    }
  }
  logger.info({ recordados, fallidos }, 'recordatorios de solicitudes de cambio');
  return { recordados, fallidos };
}
