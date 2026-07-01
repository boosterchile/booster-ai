/**
 * Procesamiento de un mensaje `document.uploaded` (frente F4-4b).
 *
 * Orquesta el camino feliz y los de fallo de un documento subido en 4a:
 *
 *   1. Claim condicional por estado (idempotencia): `UPDATE ... procesando
 *      WHERE id=? AND extraction_status IN ('pendiente','fallido')`. Si 0
 *      filas → otro intento ya lo tomó o ya está decodificado/ingreso_manual →
 *      `skipped` (no reprocesa destructivamente). Idempotencia SIN columna
 *      nueva (no requiere migración).
 *   2. Descarga el objeto de GCS.
 *   3. Ingesta (decode TED) vía `@booster-ai/transport-documents`.
 *   4. Persiste `decodificado` (campos <DD> + ted_raw + retención) o `fallido`.
 *
 * Errores transitorios (GCS/DB) se PROPAGAN: el caller (consumer) hace
 * `message.nack()` → reintento → DLQ tras `max_delivery_attempts`. Un payload
 * malformado se filtra ANTES, con Zod, en el consumer (ack que descarta).
 *
 * La función NO conoce Pub/Sub ni el driver de DB: recibe puertos (`store`,
 * `downloader`, `ingestor`) → testeable con dobles, sin red.
 */

import type { DocumentIngestor, IngestResult } from '@booster-ai/transport-documents';
import { z } from 'zod';

/**
 * Prefijo obligatorio del objeto GCS. 4a archiva SIEMPRE bajo
 * `transport-documents/<tripId>/<uuid>.<ext>` (apps/api/src/routes/
 * transport-documents.ts). Validar el prefijo evita que un publisher
 * malicioso/buggy apunte el worker a un objeto arbitrario del bucket (que es
 * compartido con certificados, fotos de chat, etc.) y lo descargue. Defensa en
 * profundidad sobre el boundary Pub/Sub.
 */
export const TRANSPORT_DOCUMENTS_PREFIX = 'transport-documents/';

/** Shape del evento publicado por el endpoint de subida (4a). */
export const documentUploadedMessageSchema = z.object({
  documentId: z.string().uuid(),
  viajeId: z.string().uuid(),
  filePath: z
    .string()
    .min(1)
    // El objeto DEBE vivir bajo el prefijo de documentos de transporte. Un
    // `filePath` fuera de prefijo (o con traversal `..`) es un payload no
    // confiable → falla el safeParse → el consumer ack-descarta (no reintenta).
    .refine((p) => p.startsWith(TRANSPORT_DOCUMENTS_PREFIX) && !p.includes('..'), {
      message: `filePath debe empezar con "${TRANSPORT_DOCUMENTS_PREFIX}" y no contener ".."`,
    }),
  fileMime: z.string().min(1),
});
export type DocumentUploadedMessage = z.infer<typeof documentUploadedMessageSchema>;

/** Operaciones de persistencia sobre `documentos_transporte` (puerto). */
export interface DocumentStore {
  /**
   * Claim condicional por estado: marca `procesando` solo si el doc está en
   * `pendiente` o `fallido` (re-intento permitido). Devuelve `true` si tomó la
   * fila, `false` si ya estaba en otro estado (idempotencia).
   */
  claimForProcessing(documentId: string): Promise<boolean>;
  /** `creado_en` de la fila — insumo del fallback de `retention_until`. */
  loadCreatedAt(documentId: string): Promise<Date | null>;
  /** Persiste el resultado decodificado (campos + ted_raw + retención). */
  persistDecoded(
    documentId: string,
    result: Extract<IngestResult, { status: 'decodificado' }>,
  ): Promise<void>;
  /** Marca el documento como `fallido` (se conserva; no bloquea el cierre). */
  markFailed(documentId: string, reason: string): Promise<void>;
}

/** Descarga el binario de un objeto GCS (puerto). */
export interface ObjectDownloader {
  download(filePath: string): Promise<Uint8Array>;
}

export type ProcessOutcome = 'decodificado' | 'fallido' | 'skipped';

export async function processDocumentUploaded(args: {
  message: DocumentUploadedMessage;
  store: DocumentStore;
  downloader: ObjectDownloader;
  ingestor: DocumentIngestor;
}): Promise<ProcessOutcome> {
  const { message, store, downloader, ingestor } = args;

  // 1) Idempotencia: claim condicional. Si no lo tomamos, ya fue procesado o
  // está en curso → no reprocesar.
  const claimed = await store.claimForProcessing(message.documentId);
  if (!claimed) {
    return 'skipped';
  }

  // Una vez tomado el claim, la fila quedó en `procesando`. Si CUALQUIER paso
  // posterior lanza (GCS/DB caído), debemos revertir el estado a `fallido`
  // ANTES de propagar: de lo contrario la fila queda atascada en `procesando`
  // para siempre (P0). El claim condicional solo retoma `pendiente`/`fallido`,
  // así que las reentregas saltarían la fila (skip) y, tras 5 nacks → DLQ, no
  // habría forma de reprocesarla ni de ingresarla manualmente. Revertir a
  // `fallido` la deja reclaimable (reproceso) y conservada (manual-entry).
  try {
    // `created_at` para el fallback de retención. Si la fila desapareció entre
    // el claim y este load (no debería), usamos `now` como base conservadora.
    const createdAt = (await store.loadCreatedAt(message.documentId)) ?? new Date();

    // 2) Descarga (error transitorio → propaga → nack).
    const buffer = await downloader.download(message.filePath);

    // 3) Ingesta best-effort (el ingestor no lanza por TED ilegible; devuelve
    // `fallido`).
    const result = await ingestor.ingest({ buffer, createdAt });

    // 4) Persistencia (error transitorio → propaga → nack).
    if (result.status === 'decodificado') {
      await store.persistDecoded(message.documentId, result);
      return 'decodificado';
    }
    await store.markFailed(message.documentId, result.reason);
    return 'fallido';
  } catch (err) {
    // Recovery del lock `procesando`: revertir a `fallido` (best-effort). Si la
    // reversión también falla, propagamos el error ORIGINAL (no lo enmascaramos)
    // y la fila quedará en `procesando` solo hasta la próxima reentrega del
    // mensaje, que reintentará este mismo path de recovery.
    const reason = err instanceof Error ? err.message : 'error_transitorio';
    try {
      await store.markFailed(message.documentId, `reset_tras_error:${reason}`);
    } catch {
      // Swallow controlado: la reversión es best-effort; el error transitorio
      // original es el que debe gobernar el nack/reintento del consumer.
    }
    throw err;
  }
}
