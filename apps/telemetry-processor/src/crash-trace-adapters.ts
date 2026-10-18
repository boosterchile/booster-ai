import type { BigQuery } from '@google-cloud/bigquery';
import type { Storage } from '@google-cloud/storage';
import type { CrashTraceIndexer, CrashTraceUploader } from './persist-crash-trace.js';

/**
 * Adapters reales que envuelven los SDKs de GCS y BigQuery con la
 * interfaz mínima que `persistCrashTrace` necesita. Mantenerlos finos:
 * cualquier lógica adicional debe ir en `persist-crash-trace.ts` para
 * que sea testeable sin red.
 */

/**
 * Crea un uploader real con `@google-cloud/storage`. Usa upload en
 * memoria (pequeño: 5-15 KB por trace, ningún problema).
 */
export function createGcsCrashTraceUploader(storage: Storage): CrashTraceUploader {
  return {
    async upload({ bucketName, objectPath, jsonContent }) {
      const bucket = storage.bucket(bucketName);
      const file = bucket.file(objectPath);
      await file.save(jsonContent, {
        contentType: 'application/json',
        // Resumable=false para uploads pequeños — más rápido y menos
        // chatter con GCS API. Crash traces son <30KB típicos.
        resumable: false,
        metadata: {
          cacheControl: 'private, max-age=0, no-store',
        },
      });
    },
  };
}

/**
 * Crea un indexer real con `@google-cloud/bigquery`. Usa
 * `insertId` derivado del crash_id para idempotencia: si el processor
 * reintenta el insert tras un fallo, BigQuery descarta el duplicado.
 */
export function createBigQueryCrashTraceIndexer(bigquery: BigQuery): CrashTraceIndexer {
  return {
    async insertRow({ datasetId, tableId, row }) {
      const table = bigquery.dataset(datasetId).table(tableId);
      // Modo raw: cada fila lleva su `insertId` y BigQuery descarta el
      // duplicado si el processor reintenta (ventana de dedup ~1 min). El
      // crash_id es un UUID v4 estable por evento. Sin `raw`, el SDK genera
      // un insertId aleatorio y un reintento duplicaba la fila.
      await table.insert([{ insertId: row.crash_id, json: row }], {
        raw: true,
        // Un row por call: si falla, falla la operación lógica completa.
        ignoreUnknownValues: false,
        skipInvalidRows: false,
      });
    },
  };
}
