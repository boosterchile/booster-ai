import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberships, trips } from '../db/schema.js';
import { type AvisoCargaPushPayload, sendPushToUser } from './web-push.js';

/**
 * Avisos por push a la transportista y al conductor cuando el generador cambia
 * algo de una carga ya asignada (spec editar-anular-cargas §8).
 *
 * Destinatarios: las membresías activas de la transportista que pueden
 * aceptar ofertas (`puedeAceptarOferta`: dueño, admin, o despachador con el
 * permiso) más el conductor de la asignación. Cada usuario recibe uno solo.
 * Los textos llevan el código del viaje, sin datos del destinatario.
 *
 * Fire-and-forget después del commit: `sendPushToUser` no lanza; un error de
 * BD sí, y el llamador lo loguea sin afectar la edición.
 */

export type EventoCargaEditada = 'datos_libres' | 'cancelacion';

const TEXTOS: Record<
  EventoCargaEditada,
  { title: string; body: (codigo: string, motivo: string | null) => string }
> = {
  datos_libres: {
    title: 'Cambiaron datos de un servicio',
    body: (codigo) => `Se actualizaron los datos de contacto o notas de ${codigo}.`,
  },
  cancelacion: {
    title: 'Servicio cancelado',
    body: (codigo, motivo) =>
      `El generador canceló el servicio ${codigo}.${motivo ? ` Motivo: ${motivo}.` : ''} No te presentes a la recogida.`,
  },
};

export async function notifyCargaEditada(
  deps: { db: Db; logger: Logger },
  opts: {
    tripId: string;
    asignacion: { id: string; empresaId: string; driverUserId: string | null };
    evento: EventoCargaEditada;
    /** Motivo de la cancelación; lo ve la transportista (§12-P6). */
    motivo?: string;
  },
): Promise<{ destinatarios: number; enviados: number }> {
  const { db, logger } = deps;
  const { tripId, asignacion, evento, motivo } = opts;

  // rls-allowlist: notificador server-side; el viaje ya lo validó el llamador.
  const [viaje] = await db
    .select({ trackingCode: trips.trackingCode })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const codigo = viaje?.trackingCode ?? tripId;

  const miembros = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.empresaId, asignacion.empresaId),
        eq(memberships.status, 'activa'),
        or(
          inArray(memberships.role, ['dueno', 'admin']),
          and(eq(memberships.role, 'despachador'), eq(memberships.puedeAceptarOfertas, true)),
        ),
      ),
    )
    .limit(50);

  const usuarios = new Set(miembros.map((m) => m.userId));
  if (asignacion.driverUserId) {
    usuarios.add(asignacion.driverUserId);
  }

  const texto = TEXTOS[evento];
  const payload: AvisoCargaPushPayload = {
    title: texto.title,
    body: texto.body(codigo, motivo ?? null),
    tag: `viaje:${tripId}:${evento}`,
    data: {
      tipo: 'aviso_carga',
      trip_id: tripId,
      assignment_id: asignacion.id,
      url: `/app/asignaciones/${asignacion.id}`,
    },
  };

  let enviados = 0;
  for (const userId of usuarios) {
    const r = await sendPushToUser({ db, logger, userId, payload });
    if (r.sent > 0) {
      enviados += 1;
    }
  }
  logger.info(
    { tripId, assignmentId: asignacion.id, evento, destinatarios: usuarios.size, enviados },
    'aviso de carga editada',
  );
  return { destinatarios: usuarios.size, enviados };
}
