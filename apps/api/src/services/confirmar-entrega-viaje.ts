/**
 * Confirmar entrega de un viaje. Servicio centralizado que dos endpoints
 * consumen:
 *
 *   - SHIPPER (canónico, default UX):
 *       PATCH /trip-requests-v2/:id/confirmar-recepcion
 *       El generador de carga marca "carga recibida" cuando confirma que
 *       llegó. Es el flujo recomendado y el que la UI promueve.
 *
 *   - CARRIER (fallback POD):
 *       PATCH /carrier/assignments/:id/confirmar-entrega
 *       El transportista marca "entrega completada" si el shipper no
 *       responde en tiempo razonable. Sirve como Proof of Delivery.
 *
 * Primer click gana. El servicio es idempotente: si el trip ya está
 * 'entregado', devuelve `alreadyDelivered=true` con el estado actual sin
 * re-disparar nada.
 *
 * Effects (transaccional):
 *   1. UPDATE trips SET status='entregado'
 *   2. UPDATE assignments SET status='entregado', delivered_at=now()
 *      WHERE trip_id = :id
 *   3. INSERT trip_events (entrega_confirmada) con source + actor
 *
 * Post-commit (fire-and-forget):
 *   - emitirCertificadoViaje() — genera el PDF firmado y lo sube a GCS.
 *     Si falla, queda como "pendiente" y un cron / job manual lo retoma
 *     después. NO bloquea la response al cliente.
 */

import type { Logger } from '@booster-ai/logger';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, tripEvents, trips } from '../db/schema.js';
import { recalcularNivelPostEntrega } from './calcular-metricas-viaje.js';
import {
  type EmitirCertificadoConfig,
  emitirCertificadoViaje,
} from './emitir-certificado-viaje.js';

/**
 * Status del trip en los que es válido confirmar entrega. Si está
 * 'entregado' ya, es idempotente (devolvemos alreadyDelivered=true). Si
 * está 'cancelado' o 'expirado', rechazamos.
 */
const STATUS_CONFIRMABLE = new Set(['asignado', 'en_proceso']);

export type ConfirmarEntregaSource = 'shipper' | 'carrier';

export type ConfirmarEntregaResult =
  | { ok: true; alreadyDelivered: false; deliveredAt: Date }
  | { ok: true; alreadyDelivered: true; deliveredAt: Date }
  | {
      ok: false;
      code: 'trip_not_found' | 'no_assignment' | 'forbidden_owner_mismatch' | 'invalid_status';
      currentStatus?: string;
    };

export async function confirmarEntregaViaje(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  source: ConfirmarEntregaSource;
  actor: {
    /** UUID de la empresa que dispara la acción (shipper o carrier). */
    empresaId: string;
    userId: string;
  };
  config: Partial<EmitirCertificadoConfig>;
}): Promise<ConfirmarEntregaResult> {
  const { db, logger, tripId, source, actor, config } = opts;

  // Tx de escritura — todo o nada para mantener consistencia.
  const txResult = await db.transaction(async (tx) => {
    // (1) Validar trip existe + permiso del actor.
    const tripRows = await tx
      .select({
        id: trips.id,
        status: trips.status,
        generadorCargaEmpresaId: trips.generadorCargaEmpresaId,
      })
      .from(trips)
      .where(eq(trips.id, tripId))
      .limit(1);
    const trip = tripRows[0];
    if (!trip) {
      return { ok: false as const, code: 'trip_not_found' as const };
    }

    // (2) Cargar assignment (puede no existir si el trip nunca fue asignado).
    const assignmentRows = await tx
      .select({
        id: assignments.id,
        empresaId: assignments.empresaId,
        deliveredAt: assignments.deliveredAt,
      })
      .from(assignments)
      .where(eq(assignments.tripId, tripId))
      .limit(1);
    const assignment = assignmentRows[0];

    // (3) Permiso: shipper debe ser owner del trip; carrier debe ser
    // owner del assignment.
    if (source === 'shipper' && trip.generadorCargaEmpresaId !== actor.empresaId) {
      return {
        ok: false as const,
        code: 'forbidden_owner_mismatch' as const,
      };
    }
    if (source === 'carrier') {
      if (!assignment) {
        return { ok: false as const, code: 'no_assignment' as const };
      }
      if (assignment.empresaId !== actor.empresaId) {
        return {
          ok: false as const,
          code: 'forbidden_owner_mismatch' as const,
        };
      }
    }

    // (4) Idempotente: si ya entregado, devolver el deliveredAt actual.
    if (trip.status === 'entregado') {
      const deliveredAt = assignment?.deliveredAt ?? new Date();
      return {
        ok: true as const,
        alreadyDelivered: true as const,
        deliveredAt,
      };
    }

    // (5) Validar transición — solo asignado/en_proceso pueden ir a entregado.
    if (!STATUS_CONFIRMABLE.has(trip.status)) {
      return {
        ok: false as const,
        code: 'invalid_status' as const,
        currentStatus: trip.status,
      };
    }

    // (6) Para confirmar entrega DEBE haber assignment — si no, ¿quién
    // entregó? Esto cubre el edge case status='asignado' pero
    // assignment row borrado por algún proceso externo.
    if (!assignment) {
      return { ok: false as const, code: 'no_assignment' as const };
    }

    // (7) UPDATEs en el orden esperado por el lifecycle.
    const now = new Date();
    await tx.update(trips).set({ status: 'entregado' }).where(eq(trips.id, tripId));
    await tx
      .update(assignments)
      .set({
        status: 'entregado',
        deliveredAt: now,
      })
      .where(and(eq(assignments.id, assignment.id), eq(assignments.tripId, tripId)));

    // (8) Audit event — quién/cómo confirmó.
    // El enum tripEventSourceEnum acepta 'web' | 'whatsapp' | 'api' | 'sistema'.
    // Tanto shipper como carrier confirman desde la PWA, así que origin = 'web'.
    // El detalle del actor (shipper/carrier) queda atribuido en payload.confirmed_via.
    await tx.insert(tripEvents).values({
      tripId,
      eventType: 'entrega_confirmada',
      source: 'web',
      payload: {
        actor_empresa_id: actor.empresaId,
        actor_user_id: actor.userId,
        confirmed_at: now.toISOString(),
        confirmed_via: source,
        assignment_id: assignment.id,
      },
    });

    return {
      ok: true as const,
      alreadyDelivered: false as const,
      deliveredAt: now,
    };
  });

  // Post-commit: si recién marcamos entregado (no idempotente), disparar
  // emisión de certificado fire-and-forget. Si ya estaba entregado, NO
  // re-disparamos (el cert ya debería existir; si no, un job de backfill
  // lo retoma).
  if (txResult.ok && !txResult.alreadyDelivered) {
    // ADR-028 §5 — re-derivar nivel de certificación con telemetría real
    // ANTES de emitir el cert. Esto convierte un trip que se persistió
    // como secundario_modeled (al asignar) en primario_verificable o
    // sigue como secundario con incertidumbre menor, según la cobertura
    // GPS efectiva del viaje. Si falla, loggeamos pero seguimos con la
    // emisión del cert con los valores estimados (no bloqueamos al
    // cliente).
    try {
      await recalcularNivelPostEntrega({ db, logger, tripId });
    } catch (err) {
      logger.error(
        { err, tripId },
        'recalcularNivelPostEntrega fallo — emitiendo cert con valores estimados',
      );
    }

    emitirCertificadoViaje({ db, logger, tripId, config })
      .then((res) => {
        if (res.skipped) {
          logger.warn(
            { tripId, reason: res.reason },
            'emitirCertificadoViaje skipped tras entrega',
          );
        } else {
          logger.info(
            {
              tripId,
              pdfSha256: res.pdfSha256,
              kmsKeyVersion: res.kmsKeyVersion,
            },
            'certificado emitido tras entrega',
          );
        }
      })
      .catch((err) => {
        // Defensa-en-profundidad: emitirCertificadoViaje no debería
        // throwear (es defensivo), pero si lo hace por algún path no
        // cubierto, no queremos crashear el process. Lo loggeamos y
        // dejamos que el job de backfill lo retome.
        logger.error(
          { err, tripId },
          'emitirCertificadoViaje throwed inesperadamente — pendiente para backfill',
        );
      });
  }

  return txResult;
}
