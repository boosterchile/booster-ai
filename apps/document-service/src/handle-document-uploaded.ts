/**
 * Manejo de un mensaje `document.uploaded`, común a los dos transportes del
 * worker (ADR-085): StreamingPull (`message.ack()`/`nack()`) y push HTTP
 * (2xx/5xx). Recibe los bytes crudos del mensaje y decide `ack` o `nack`:
 *
 *   - JSON inválido o fuera de contrato (Zod) → `ack`: es un dato malo que
 *     ningún reintento arregla. Se registra como error y se descarta.
 *   - Procesado o skip idempotente → `ack`.
 *   - Error transitorio (GCS/DB) → `nack`: Pub/Sub reintenta con backoff y
 *     tras `max_delivery_attempts` (=5, messaging.tf) lo manda a la DLQ.
 *
 * Los textos de log son contrato con los runbooks y el drill de rollback
 * (`docs/runbooks/rollback-drill-microservicios.md` busca
 * `document.uploaded procesado`). No cambiarlos sin actualizar esos docs.
 */

import type { Logger } from '@booster-ai/logger';
import type { DocumentIngestor } from '@booster-ai/transport-documents';
import {
  type DocumentStore,
  type ObjectDownloader,
  documentUploadedMessageSchema,
  processDocumentUploaded,
} from './process-document-uploaded.js';

export type AckDecision = 'ack' | 'nack';

export interface DocumentUploadedDelivery {
  /** Bytes del mensaje (`message.data`). */
  data: Buffer;
  messageId: string;
  /** Intento de entrega según Pub/Sub (solo viene con DLQ configurada). */
  deliveryAttempt?: number | undefined;
}

export interface DocumentUploadedDeps {
  store: DocumentStore;
  downloader: ObjectDownloader;
  ingestor: DocumentIngestor;
  logger: Logger;
}

export type DocumentUploadedHandler = (delivery: DocumentUploadedDelivery) => Promise<AckDecision>;

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    // El error de JSON.parse no aporta más que el preview que se loguea arriba.
    return { ok: false };
  }
}

export function createDocumentUploadedHandler(deps: DocumentUploadedDeps): DocumentUploadedHandler {
  const { store, downloader, ingestor, logger } = deps;

  return async ({ data, messageId, deliveryAttempt }) => {
    const start = Date.now();
    const raw = data.toString('utf-8');

    const json = parseJson(raw);
    const parsed = json.ok ? documentUploadedMessageSchema.safeParse(json.value) : null;
    if (parsed === null || !parsed.success) {
      logger.error(
        {
          messageId,
          deliveryAttempt,
          errors: parsed === null ? [{ message: 'JSON inválido' }] : parsed.error.issues,
          bodyPreview: raw.slice(0, 200),
        },
        'document.uploaded malformado, ack para descartar (no reintentar)',
      );
      return 'ack';
    }

    try {
      const outcome = await processDocumentUploaded({
        message: parsed.data,
        store,
        downloader,
        ingestor,
      });
      logger.info(
        {
          messageId,
          deliveryAttempt,
          documentId: parsed.data.documentId,
          viajeId: parsed.data.viajeId,
          outcome,
          latencyMs: Date.now() - start,
        },
        'document.uploaded procesado',
      );
      return 'ack';
    } catch (err) {
      logger.error(
        { err, messageId, deliveryAttempt, documentId: parsed.data.documentId },
        'error procesando document.uploaded, nack para reintento',
      );
      return 'nack';
    }
  };
}
