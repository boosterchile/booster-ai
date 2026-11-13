import type { Logger } from '@booster-ai/logger';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { conductorDeAsignacion, vehiculoDeAsignacion } from '../db/configuracion-de-asignacion.js';
import { assignments, trips } from '../db/schema.js';
import { type EventoCambioCarga, notifyCambioCarga } from './notify-cambio-carga.js';

/**
 * Recordatorios cuando una asignación aceptada sigue sin vehículo
 * (matching-desde-la-carga §3.9 / §11-3).
 *
 * Etapas (claim con `FOR UPDATE SKIP LOCKED` + marca de idempotencia;
 * si el aviso falla o `enviados===0` se limpia la marca para reintentar):
 *   - 24 h antes del inicio de la ventana → oficina transportista
 *   - 2 h antes → oficina transportista
 *   - ventana ya iniciada → aviso al generador
 *
 * Canales: los mismos que los recordatorios de cambio de carga
 * (`notifyCambioCarga` / Web Push a membresías que aceptan ofertas).
 *
 * Es cross-empresa por diseño (job de plataforma).
 */

const TOPE_POR_CORRIDA = 200;

export type EtapaVehiculoPendiente = '24h' | '2h' | 'ventana_iniciada';

export interface ResultadoRecordatoriosVehiculo {
  recordadosOficina: number;
  avisadosGenerador: number;
  fallidos: number;
}

type Tomada = {
  id: string;
  tripId: string;
  empresaId: string;
  driverUserId: string | null;
};

const EVENTO_POR_ETAPA: Record<EtapaVehiculoPendiente, EventoCambioCarga> = {
  '24h': 'vehiculo_pendiente_24h',
  '2h': 'vehiculo_pendiente_2h',
  ventana_iniciada: 'vehiculo_pendiente_vencido',
};

async function tomarEtapa(db: Db, etapa: EtapaVehiculoPendiente, now: Date): Promise<Tomada[]> {
  return db.transaction(async (tx) => {
    const sinVehiculo = sql`${vehiculoDeAsignacion} IS NULL`;
    const base = and(
      eq(assignments.status, 'asignado'),
      sinVehiculo,
      sql`${trips.pickupWindowStart} IS NOT NULL`,
    );

    const porEtapa =
      etapa === '24h'
        ? and(
            isNull(assignments.vehicleReminder24hAt),
            // [start−24h, start−2h)
            lte(sql`${trips.pickupWindowStart} - interval '24 hours'`, now),
            gt(sql`${trips.pickupWindowStart} - interval '2 hours'`, now),
          )
        : etapa === '2h'
          ? and(
              isNull(assignments.vehicleReminder2hAt),
              // [start−2h, start)
              lte(sql`${trips.pickupWindowStart} - interval '2 hours'`, now),
              gt(trips.pickupWindowStart, now),
            )
          : and(
              isNull(assignments.vehicleMissingGeneratorNotifiedAt),
              // start ≤ now
              lte(trips.pickupWindowStart, now),
            );

    // rls-allowlist: job de plataforma cross-empresa (§3.9); solo lee
    // asignaciones sin vehículo con etapa pendiente.
    const filas = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .where(and(base, porEtapa))
      .orderBy(trips.pickupWindowStart)
      .limit(TOPE_POR_CORRIDA)
      .for('update', { skipLocked: true });

    if (filas.length === 0) {
      return [];
    }

    const ids = filas.map((f) => f.id);
    const marca =
      etapa === '24h'
        ? { vehicleReminder24hAt: now }
        : etapa === '2h'
          ? { vehicleReminder2hAt: now }
          : { vehicleMissingGeneratorNotifiedAt: now };

    // rls-allowlist: job de plataforma cross-empresa (§3.9); marca las filas
    // bloqueadas arriba (claim). Si el aviso no es útil se libera abajo.
    return await tx
      .update(assignments)
      .set(marca)
      .where(and(inArray(assignments.id, ids), eq(assignments.status, 'asignado'), sinVehiculo))
      .returning({
        id: assignments.id,
        tripId: assignments.tripId,
        empresaId: assignments.empresaId,
        driverUserId: conductorDeAsignacion,
      });
  });
}

/** Limpia la marca de claim para que la próxima corrida pueda reintentar. */
async function liberarEtapa(db: Db, etapa: EtapaVehiculoPendiente, id: string): Promise<void> {
  const limpia =
    etapa === '24h'
      ? { vehicleReminder24hAt: null }
      : etapa === '2h'
        ? { vehicleReminder2hAt: null }
        : { vehicleMissingGeneratorNotifiedAt: null };
  // rls-allowlist: job de plataforma cross-empresa (§3.9); libera claim fallido.
  await db.update(assignments).set(limpia).where(eq(assignments.id, id));
}

export async function recordarVehiculoPendiente(deps: {
  db: Db;
  logger: Logger;
  /** Inyectable para tests; por defecto el instante actual. */
  now?: Date;
  /** Inyectable para tests; por defecto el push de `notify-cambio-carga`. */
  avisar?: typeof notifyCambioCarga;
}): Promise<ResultadoRecordatoriosVehiculo> {
  const { db, logger } = deps;
  const now = deps.now ?? new Date();
  const avisar = deps.avisar ?? notifyCambioCarga;

  const etapas: EtapaVehiculoPendiente[] = ['24h', '2h', 'ventana_iniciada'];
  let recordadosOficina = 0;
  let avisadosGenerador = 0;
  let fallidos = 0;

  for (const etapa of etapas) {
    const tomadas = await tomarEtapa(db, etapa, now);
    const evento = EVENTO_POR_ETAPA[etapa];
    for (const t of tomadas) {
      try {
        const resultado = await avisar(
          { db, logger },
          {
            tripId: t.tripId,
            asignacion: {
              id: t.id,
              empresaId: t.empresaId,
              driverUserId: t.driverUserId,
            },
            evento,
          },
        );
        if (resultado.enviados === 0) {
          await liberarEtapa(db, etapa, t.id);
          fallidos += 1;
          logger.warn(
            {
              assignmentId: t.id,
              tripId: t.tripId,
              etapa,
              destinatarios: resultado.destinatarios,
              enviados: resultado.enviados,
            },
            'recordatorio de vehículo pendiente sin destinatarios alcanzados',
          );
          continue;
        }
        if (etapa === 'ventana_iniciada') {
          avisadosGenerador += 1;
        } else {
          recordadosOficina += 1;
        }
      } catch (err) {
        try {
          await liberarEtapa(db, etapa, t.id);
        } catch (liberarErr) {
          logger.error(
            { err: liberarErr, assignmentId: t.id, tripId: t.tripId, etapa },
            'no se pudo liberar la marca de recordatorio de vehículo pendiente',
          );
        }
        fallidos += 1;
        logger.warn(
          { err, assignmentId: t.id, tripId: t.tripId, etapa },
          'recordatorio de vehículo pendiente falló',
        );
      }
    }
  }

  logger.info(
    { recordadosOficina, avisadosGenerador, fallidos },
    'recordatorios de vehículo pendiente',
  );
  return { recordadosOficina, avisadosGenerador, fallidos };
}
