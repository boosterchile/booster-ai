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
      await table.insert([row], {
        // Failure de un row hace tirar todo el batch (un row por call,
        // así que es 1:1 con la operación lógica).
        ignoreUnknownValues: false,
        skipInvalidRows: false,
        // Idempotency: BigQuery dedup por insertId en ventana ~1 min.
        // El crash_id es UUID v4 estable por evento — perfect insertId.
        // Cast porque el tipo de @google-cloud/bigquery espera arrays
        // específicos.
        // biome-ignore lint/suspicious/noExplicitAny: SDK overload
        ...({ insertIds: [row.crash_id] } as any),
      });
    },
  };
}
