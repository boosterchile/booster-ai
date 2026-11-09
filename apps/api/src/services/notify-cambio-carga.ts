import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { memberships, trips } from '../db/schema.js';
import { type AvisoCargaPushPayload, sendPushToUser } from './web-push.js';

/**
 * Avisos por push cuando cambia una carga ya asignada (spec
 * editar-anular-cargas §8).
 *
 * Destinatarios por grupo:
 *   - transportista: las membresías activas que pueden aceptar ofertas
 *     (`puedeAceptarOferta`: dueño, admin, o despachador con el permiso);
 *   - conductor: el de la asignación;
 *   - generador: quien creó la carga (`viajes.creado_por_id`).
 * Cada usuario recibe un solo aviso, con el texto del primer grupo en que
 * aparece (generador, transportista, conductor). Los textos llevan el código
 * del viaje, sin datos del destinatario; al conductor nunca le llegan los
 * datos propuestos.
 *
 * Fire-and-forget después del commit: `sendPushToUser` no lanza; un error de
 * BD sí, y el llamador lo loguea sin afectar la operación.
 */

export type EventoCambioCarga =
  | 'datos_libres'
  | 'cancelacion'
  | 'cambio_solicitado'
  | 'cambio_aceptado'
  | 'cambio_rechazado'
  | 'cambio_retirado'
  | 'cambio_recordatorio';

type Grupo = 'generador' | 'transportista' | 'conductor';

interface Texto {
  title: string;
  body: (codigo: string, motivo: string | null) => string;
}

const ORDEN_GRUPOS: readonly Grupo[] = ['generador', 'transportista', 'conductor'];

const datosLibres: Texto = {
  title: 'Cambiaron datos de un servicio',
  body: (codigo) => `Se actualizaron los datos de contacto o notas de ${codigo}.`,
};

const cancelacion: Texto = {
  title: 'Servicio cancelado',
  body: (codigo, motivo) =>
    `El generador canceló el servicio ${codigo}.${motivo ? ` Motivo: ${motivo}.` : ''} No te presentes a la recogida.`,
};

const datosCambiaron: Texto = {
  title: 'Cambiaron datos de un servicio',
  body: (codigo) => `Cambiaron los datos del servicio ${codigo}.`,
};

const cambioRetirado: Texto = {
  title: 'Cambio retirado',
  body: (codigo) => `El generador retiró el cambio propuesto en ${codigo}.`,
};

const AVISOS: Record<EventoCambioCarga, Partial<Record<Grupo, Texto>>> = {
  datos_libres: { transportista: datosLibres, conductor: datosLibres },
  cancelacion: { transportista: cancelacion, conductor: cancelacion },
  cambio_solicitado: {
    transportista: {
      title: 'Cambio propuesto',
      body: (codigo) =>
        `El generador propone un cambio en ${codigo}. Respóndelo antes de la recogida.`,
    },
    conductor: {
      title: 'Cambio pendiente',
      body: (codigo) =>
        `Hay un cambio pendiente en ${codigo}. Espera la respuesta de tu transportista antes de recoger.`,
    },
  },
  cambio_aceptado: { generador: datosCambiaron, conductor: datosCambiaron },
  cambio_rechazado: {
    generador: {
      title: 'Cambio rechazado',
      body: (codigo) => `El transportista rechazó el cambio en ${codigo}.`,
    },
    conductor: {
      title: 'Servicio sin cambios',
      body: (codigo) => `El servicio ${codigo} sigue sin cambios; ya puedes recoger.`,
    },
  },
  cambio_retirado: { transportista: cambioRetirado, conductor: cambioRetirado },
  // El job de recordatorios (§6.14): el tag fijo hace que el navegador
  // reemplace el aviso anterior en vez de apilarlos.
  cambio_recordatorio: {
    transportista: {
      title: 'Cambio sin responder',
      body: (codigo) =>
        `Tienes un cambio sin responder en ${codigo}. No se puede confirmar la recogida hasta que respondas.`,
    },
  },
};

export async function notifyCambioCarga(
  deps: { db: Db; logger: Logger },
  opts: {
    tripId: string;
    asignacion: { id: string; empresaId: string; driverUserId: string | null };
    evento: EventoCambioCarga;
    /** Motivo de la cancelación; lo ve la transportista (§12-P6). */
    motivo?: string;
  },
): Promise<{ destinatarios: number; enviados: number }> {
  const { db, logger } = deps;
  const { tripId, asignacion, evento, motivo } = opts;
  const textos = AVISOS[evento];

  // rls-allowlist: notificador server-side; el viaje ya lo validó el llamador.
  const [viaje] = await db
    .select({ trackingCode: trips.trackingCode, createdByUserId: trips.createdByUserId })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);
  const codigo = viaje?.trackingCode ?? tripId;

  const porGrupo: Record<Grupo, string[]> = { generador: [], transportista: [], conductor: [] };
  if (textos.generador && viaje?.createdByUserId) {
    porGrupo.generador.push(viaje.createdByUserId);
  }
  if (textos.transportista) {
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
    porGrupo.transportista.push(...miembros.map((m) => m.userId));
  }
  if (textos.conductor && asignacion.driverUserId) {
    porGrupo.conductor.push(asignacion.driverUserId);
  }

  // Un aviso por usuario, con el texto del primer grupo en que aparece.
  const destino = new Map<string, { grupo: Grupo; texto: Texto }>();
  for (const grupo of ORDEN_GRUPOS) {
    const texto = textos[grupo];
    if (!texto) {
      continue;
    }
    for (const userId of porGrupo[grupo]) {
      if (!destino.has(userId)) {
        destino.set(userId, { grupo, texto });
      }
    }
  }

  let enviados = 0;
  for (const [userId, { grupo, texto }] of destino) {
    const payload: AvisoCargaPushPayload = {
      title: texto.title,
      body: texto.body(codigo, motivo ?? null),
      tag: `viaje:${tripId}:${evento}`,
      data: {
        tipo: 'aviso_carga',
        trip_id: tripId,
        assignment_id: asignacion.id,
        url: grupo === 'generador' ? `/app/cargas/${tripId}` : `/app/asignaciones/${asignacion.id}`,
      },
    };
    const r = await sendPushToUser({ db, logger, userId, payload });
    if (r.sent > 0) {
      enviados += 1;
    }
  }
  logger.info(
    { tripId, assignmentId: asignacion.id, evento, destinatarios: destino.size, enviados },
    'aviso de cambio de carga',
  );
  return { destinatarios: destino.size, enviados };
}
