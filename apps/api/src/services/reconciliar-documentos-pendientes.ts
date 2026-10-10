import type { Logger } from '@booster-ai/logger';
import { PubSub } from '@google-cloud/pubsub';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';

/**
 * Un `pendiente` sin tocar por este lapso se republica. Cubre los documentos
 * subidos sin topic configurado y los publish fallidos (fire-and-forget en
 * `routes/transport-documents.ts`). Tocar `actualizado_en` al republicar
 * espacia los reintentos de un mismo documento a uno por ventana.
 */
export const MINUTOS_PENDIENTE_ANTES_DE_REPUBLICAR = 10;

/**
 * Un `procesando` sin tocar por este lapso es un worker que murió a mitad
 * (OOM al rasterizar, revisión reemplazada). El decode de un documento toma
 * segundos; 30 min no es un procesamiento lento sino uno abandonado.
 */
export const MINUTOS_PROCESANDO_ANTES_DE_LIBERAR = 30;

/** Máximo de documentos republicados por tick. */
export const LIMITE_REPUBLICACION_POR_TICK = 100;

/** Payload de `document.uploaded`, el mismo que valida el worker. */
export interface DocumentoSubidoMensaje {
  documentId: string;
  viajeId: string;
  filePath: string;
  fileMime: string;
}

export type PublicarDocumentoSubido = (mensaje: DocumentoSubidoMensaje) => Promise<void>;

export function crearPublicadorDocumentoSubido(topicName: string): PublicarDocumentoSubido {
  const topic = new PubSub().topic(topicName);
  return async (mensaje) => {
    // rls-allowlist: publishMessage de Pub/Sub (document.uploaded); no es query Drizzle.
    await topic.publishMessage({ data: Buffer.from(JSON.stringify(mensaje)) });
  };
}

export interface ResultadoReconciliacion {
  liberados: number;
  republicados: number;
  fallidosPublicacion: number;
}

/**
 * Reconciliación de `documentos_transporte` contra el worker TED
 * (`apps/document-service`). Invocado por Cloud Scheduler vía
 * POST /admin/jobs/documentos-pendientes.
 *
 * 1. `procesando` abandonado → `fallido`. No se republica: si el documento
 *    tumbó al worker, republicarlo repetiría la caída cada media hora.
 *    `fallido` deja el documento conservado y habilitado para ingreso manual.
 * 2. `pendiente` viejo → se republica a `document.uploaded`. El claim
 *    condicional del worker (`pendiente|fallido` → `procesando`) vuelve
 *    inocuo un mensaje duplicado.
 */
export async function reconciliarDocumentosPendientes(opts: {
  db: Db;
  logger: Logger;
  publicar: PublicarDocumentoSubido;
  limite?: number;
}): Promise<ResultadoReconciliacion> {
  const { db, logger, publicar } = opts;
  const limite = opts.limite ?? LIMITE_REPUBLICACION_POR_TICK;

  // rls-allowlist: cron server-side cross-tenant; el worker TED no tiene tenant.
  const liberacion = await db.execute(sql`
    UPDATE documentos_transporte
    SET extraction_status = 'fallido', actualizado_en = now()
    WHERE extraction_status = 'procesando'
      AND actualizado_en < now() - make_interval(mins => ${MINUTOS_PROCESANDO_ANTES_DE_LIBERAR})
  `);
  const liberados = liberacion.rowCount ?? 0;

  // rls-allowlist: cron server-side cross-tenant; el worker TED no tiene tenant.
  const candidatos = await db.execute<{
    id: string;
    viaje_id: string;
    file_path: string;
    file_mime: string;
  }>(sql`
    UPDATE documentos_transporte
    SET actualizado_en = now()
    WHERE id IN (
      SELECT id FROM documentos_transporte
      WHERE extraction_status = 'pendiente'
        AND actualizado_en < now() - make_interval(mins => ${MINUTOS_PENDIENTE_ANTES_DE_REPUBLICAR})
      ORDER BY actualizado_en
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, viaje_id, file_path, file_mime
  `);

  let republicados = 0;
  let fallidosPublicacion = 0;
  for (const fila of candidatos.rows) {
    try {
      await publicar({
        documentId: fila.id,
        viajeId: fila.viaje_id,
        filePath: fila.file_path,
        fileMime: fila.file_mime,
      });
      republicados++;
    } catch (err) {
      fallidosPublicacion++;
      logger.error(
        { err, documentId: fila.id },
        'republicación de document.uploaded falló; se reintenta en el próximo tick',
      );
    }
  }

  logger.info(
    { liberados, republicados, fallidosPublicacion },
    'reconciliación de documentos_transporte completada',
  );
  return { liberados, republicados, fallidosPublicacion };
}
