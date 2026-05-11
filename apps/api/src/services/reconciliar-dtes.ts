import { DteProviderError, DteTransientError } from '@booster-ai/dte-provider';
import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { facturasBoosterClp, liquidaciones } from '../db/schema.js';
import { getDteEmitter } from './dte-emitter-factory.js';
import { emitirDteLiquidacion } from './emitir-dte-liquidacion.js';

/**
 * ADR-024 — Cron de reconciliación de DTEs.
 *
 * Dos responsabilidades por tick:
 *
 *   1. **queryStatus de facturas `en_proceso`**: cuando emitimos un DTE,
 *      Sovos típicamente devuelve folio inmediato pero el SII aún no
 *      lo aceptó. Periódicamente preguntamos `adapter.queryStatus()` y
 *      actualizamos `dte_status` ∈ {aceptado | rechazado | reparable |
 *      anulado | en_proceso}.
 *
 *   2. **retry de transient errors**: facturas con tipo `comision_trip`
 *      que tienen `liquidacionId` pero NO `dteFolio` y status='pending_dte'
 *      vienen de un `emitFactura` que falló transient (timeout, 5xx).
 *      Reintenta `emitirDteLiquidacion` cuyo race-safety check detecta
 *      si alguien ya emitió en paralelo.
 *
 * **Frecuencia objetivo**: 1×/hora. Volumen esperado: <100 facturas/tick.
 * Si crece, paginar con LIMIT + OFFSET (hoy LIMIT 500 hard cap).
 *
 * **Idempotente y safe re-correr**: cada paso es no-op si no aplica.
 *
 * **No-op si**:
 *   - `PRICING_V2_ACTIVATED=false` (flag global apaga el módulo).
 *   - Adapter es `null` (DTE_PROVIDER=disabled o sin creds Sovos).
 */

export interface ReconciliarDtesInput {
  db: Db;
  logger: Logger;
  /**
   * Cuántas facturas `en_proceso` consultar por tick. Default 200.
   * Cap superior 500.
   */
  queryStatusLimit?: number;
  /**
   * Cuántas facturas con transient error reintentar por tick. Default 50.
   * Cap superior 100.
   */
  retryEmitLimit?: number;
  /**
   * Edad mínima para que una factura `en_proceso` se reconcile. Evita
   * race con emitFactura que recién terminó. Default 60 segundos.
   */
  minAgeForReconcileSeconds?: number;
}

export interface ReconciliarDtesResult {
  /** Cuántas facturas `en_proceso` se consultaron (incl. sin cambios). */
  queriedStatus: number;
  /** De las consultadas, cuántas cambiaron de status. */
  statusUpdated: number;
  /** Cuántas facturas con transient error se reintentaron. */
  retried: number;
  /** De las reintentadas, cuántas terminaron emitidas. */
  retriedOk: number;
}

export async function reconciliarDtes(input: ReconciliarDtesInput): Promise<ReconciliarDtesResult> {
  const {
    db,
    logger,
    queryStatusLimit = 200,
    retryEmitLimit = 50,
    minAgeForReconcileSeconds = 60,
  } = input;

  if (!appConfig.PRICING_V2_ACTIVATED) {
    logger.debug('reconciliarDtes: PRICING_V2_ACTIVATED=false, skip');
    return { queriedStatus: 0, statusUpdated: 0, retried: 0, retriedOk: 0 };
  }
  const adapter = getDteEmitter(logger);
  if (!adapter) {
    logger.debug('reconciliarDtes: no hay adapter activo, skip');
    return { queriedStatus: 0, statusUpdated: 0, retried: 0, retriedOk: 0 };
  }

  const limitQuery = Math.min(Math.max(queryStatusLimit, 1), 500);
  const limitRetry = Math.min(Math.max(retryEmitLimit, 1), 100);

  // Step 1: reconciliar facturas en_proceso con queryStatus.
  // rls-allowlist: cron platform-wide.
  const enProcesoRows = await db
    .select({
      facturaId: facturasBoosterClp.id,
      dteFolio: facturasBoosterClp.dteFolio,
      dteTipo: facturasBoosterClp.dteTipo,
      empresaDestinoId: facturasBoosterClp.empresaDestinoId,
    })
    .from(facturasBoosterClp)
    .where(
      and(
        eq(facturasBoosterClp.dteStatus, 'en_proceso'),
        isNotNull(facturasBoosterClp.dteFolio),
        // Solo facturas con al menos `minAgeForReconcileSeconds` de
        // antigüedad para evitar race con emitFactura que recién terminó.
        lt(
          facturasBoosterClp.dteEmitidaEn,
          sql`now() - (${minAgeForReconcileSeconds} || ' seconds')::interval`,
        ),
      ),
    )
    .orderBy(desc(facturasBoosterClp.dteEmitidaEn))
    .limit(limitQuery);

  let statusUpdated = 0;
  for (const row of enProcesoRows) {
    if (!row.dteFolio) {
      continue;
    }
    // Necesitamos el RUT del emisor — que en nuestro modelo es Booster
    // (BOOSTER_RUT). El adapter queryStatus toma (folio, rutEmisor).
    // En el futuro, si emitimos por carrier (DTE 52), aquí cambiamos.
    let dteStatus: Awaited<ReturnType<typeof adapter.queryStatus>>;
    try {
      dteStatus = await adapter.queryStatus(row.dteFolio, appConfig.BOOSTER_RUT);
    } catch (err) {
      if (err instanceof DteTransientError) {
        logger.warn(
          { err, facturaId: row.facturaId, folio: row.dteFolio },
          'reconciliarDtes: queryStatus transient, retry next tick',
        );
        continue;
      }
      if (err instanceof DteProviderError) {
        logger.error(
          { err, facturaId: row.facturaId, folio: row.dteFolio },
          'reconciliarDtes: queryStatus provider error — skip esta factura',
        );
        continue;
      }
      // Error inesperado: throw para que Cloud Scheduler reintente el tick.
      throw err;
    }

    // No persistir si el status no cambió (evita UPDATE no-op + escritura
    // del trigger updated_at).
    if (dteStatus.status === 'en_proceso') {
      continue;
    }
    // rls-allowlist: cron platform-wide.
    await db
      .update(facturasBoosterClp)
      .set({
        dteStatus: dteStatus.status,
        updatedAt: sql`now()`,
      })
      .where(eq(facturasBoosterClp.id, row.facturaId));
    statusUpdated++;
    logger.info(
      {
        facturaId: row.facturaId,
        folio: row.dteFolio,
        nuevoStatus: dteStatus.status,
        mensaje: dteStatus.mensaje ?? null,
      },
      'reconciliarDtes: dte_status actualizado',
    );
  }

  // Step 2: retry facturas comision_trip con transient error.
  // Heurística: factura con tipo='comision_trip' + liquidacion_id + sin
  // dte_folio + status='pending_dte' + más de 5 min de antigüedad
  // (evita race con el wire post-INSERT que está en progreso).
  // rls-allowlist: cron platform-wide.
  const transientRows = await db
    .select({
      facturaId: facturasBoosterClp.id,
      liquidacionId: facturasBoosterClp.liquidacionId,
    })
    .from(facturasBoosterClp)
    .innerJoin(liquidaciones, eq(liquidaciones.id, facturasBoosterClp.liquidacionId))
    .where(
      and(
        eq(facturasBoosterClp.tipo, 'comision_trip'),
        isNotNull(facturasBoosterClp.liquidacionId),
        isNull(facturasBoosterClp.dteFolio),
        eq(facturasBoosterClp.status, 'pending_dte'),
        lt(facturasBoosterClp.createdAt, sql`now() - interval '5 minutes'`),
        eq(liquidaciones.status, 'lista_para_dte'),
      ),
    )
    .orderBy(desc(facturasBoosterClp.createdAt))
    .limit(limitRetry);

  let retried = 0;
  let retriedOk = 0;
  for (const row of transientRows) {
    if (!row.liquidacionId) {
      continue;
    }
    retried++;
    try {
      const result = await emitirDteLiquidacion({
        db,
        logger,
        liquidacionId: row.liquidacionId,
      });
      if (result.status === 'emitido' || result.status === 'ya_emitido') {
        retriedOk++;
        logger.info(
          { liquidacionId: row.liquidacionId, dteStatus: result.status },
          'reconciliarDtes: retry emit OK',
        );
      } else {
        logger.warn(
          { liquidacionId: row.liquidacionId, dteStatus: result.status },
          'reconciliarDtes: retry emit no-emitido',
        );
      }
    } catch (err) {
      logger.error(
        { err, liquidacionId: row.liquidacionId },
        'reconciliarDtes: retry emit threw — skip',
      );
    }
  }

  logger.info(
    {
      queriedStatus: enProcesoRows.length,
      statusUpdated,
      retried,
      retriedOk,
    },
    'reconciliarDtes: tick completado',
  );

  return {
    queriedStatus: enProcesoRows.length,
    statusUpdated,
    retried,
    retriedOk,
  };
}
