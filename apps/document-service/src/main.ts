/**
 * Bootstrap del Cloud Run service `booster-ai-document-service`.
 *
 * Inyecta los adapters de producción:
 *   - DteProvider: BsaleAdapter (config.DTE_PROVIDER === 'bsale')
 *                  o MockDteProvider (dev local)
 *   - DocumentRepo: implementación Drizzle conectada al schema de Postgres.
 *                  STUB por ahora — el schema `documentos` existe pero la
 *                  migration está pendiente. Hasta entonces, fallback a
 *                  in-memory store con warn log.
 *   - BlobStore: implementación @google-cloud/storage del bucket
 *                `documents_bucket`.
 *
 * El módulo NO contiene lógica de negocio — solo cableado. La lógica está
 * en `app.ts` (Hono routes) que es testeable con mocks.
 */

import type {
  BlobStore,
  DocumentRecord,
  DocumentRepo,
  ListDocumentsFilter,
} from '@booster-ai/document-indexer';
import { type DteProvider, MockDteProvider } from '@booster-ai/dte-provider';
import { type Logger, createLogger } from '@booster-ai/logger';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const logger = createLogger({
  service: '@booster-ai/document-service',
  version: '0.0.0',
  level: 'info',
  pretty: process.env.NODE_ENV === 'development',
});

const port = Number(process.env.PORT ?? 8080);
const bucket = process.env.DOCUMENTS_BUCKET;
if (!bucket) {
  logger.fatal('DOCUMENTS_BUCKET env var requerido');
  process.exit(1);
}

const dteProvider = createDteProvider(logger);
const documentRepo = createDocumentRepo(logger);
const blobStore = createBlobStore(logger, bucket);

const app = createApp({
  logger,
  dteProvider,
  documentRepo,
  blobStore,
  bucket,
});

serve({ fetch: app.fetch, port }, ({ port: actualPort }) => {
  logger.info({ port: actualPort }, 'document-service listening');
});

// ---------------------------------------------------------------------------
// Factories de adapters
// ---------------------------------------------------------------------------

function createDteProvider(log: Logger): DteProvider {
  const providerName = process.env.DTE_PROVIDER ?? 'mock';
  if (providerName === 'bsale') {
    // TODO: importar y usar `BsaleAdapter` de `@booster-ai/dte-provider`
    // cuando el PR del BsaleAdapter (#29) mergee. Hasta entonces, este
    // path sigue cayendo en MockDteProvider con error log loud.
    log.error(
      'DTE_PROVIDER=bsale solicitado pero BsaleAdapter no disponible en este build. ' +
        'Esperar merge de PR #29 (feat/dte-provider-bsale-adapter). Fallback a MockDteProvider.',
    );
  }
  log.warn(
    { provider: 'mock' },
    'DteProvider en MOCK — solo para dev local. Set DTE_PROVIDER=bsale en prod (post-merge #29).',
  );
  return new MockDteProvider();
}

/**
 * STUB: implementación in-memory hasta que la migration `documentos` exista.
 *
 * Cuando la migration esté lista, reemplazar por adapter Drizzle:
 * ```ts
 * function createDrizzleRepo(db: Db): DocumentRepo {
 *   return {
 *     insert: async (r) => { await db.insert(documentos).values(r); },
 *     findById: async (id) => { ... },
 *     // ...
 *   };
 * }
 * ```
 */
function createDocumentRepo(log: Logger): DocumentRepo {
  log.warn('DocumentRepo en STUB in-memory — migration `documentos` pendiente. NO USAR EN PROD.');
  const store = new Map<string, DocumentRecord>();
  return {
    insert: async (record) => {
      store.set(record.id, record);
    },
    findById: async (id) => store.get(id) ?? null,
    list: async (filter: ListDocumentsFilter) => {
      let list = [...store.values()];
      if (filter.tripId) {
        list = list.filter((d) => d.tripId === filter.tripId);
      }
      if (filter.type) {
        list = list.filter((d) => d.type === filter.type);
      }
      if (filter.emittedAfter) {
        list = list.filter((d) => d.emittedAt.getTime() >= filter.emittedAfter?.getTime());
      }
      if (filter.emittedBefore) {
        list = list.filter((d) => d.emittedAt.getTime() < filter.emittedBefore?.getTime());
      }
      return list.slice(filter.offset, filter.offset + filter.limit);
    },
    findExpired: async (asOf, limit) => {
      return [...store.values()]
        .filter((d) => d.retentionUntil.getTime() <= asOf.getTime())
        .slice(0, limit);
    },
    delete: async (id) => {
      store.delete(id);
    },
  };
}

/**
 * STUB: BlobStore que NO sube nada. Solo retorna URLs simuladas.
 *
 * Cuando se cablée con `@google-cloud/storage`:
 * ```ts
 * import { Storage } from '@google-cloud/storage';
 * const storage = new Storage();
 * const bucketRef = storage.bucket(bucket);
 * return {
 *   getSignedReadUrl: async ({ objectName, expiresInSeconds }) => {
 *     const [url] = await bucketRef.file(objectName).getSignedUrl({
 *       version: 'v4',
 *       action: 'read',
 *       expires: Date.now() + expiresInSeconds * 1000,
 *     });
 *     return url;
 *   },
 *   // ...
 * };
 * ```
 */
function createBlobStore(log: Logger, bucket: string): BlobStore {
  log.warn({ bucket }, 'BlobStore en STUB — @google-cloud/storage no cableado. NO USAR EN PROD.');
  return {
    getSignedReadUrl: async ({ objectName }) =>
      `https://stub.local/read/${encodeURIComponent(objectName)}`,
    getSignedUploadUrl: async ({ objectName }) =>
      `https://stub.local/upload/${encodeURIComponent(objectName)}`,
    statObject: async () => ({ sizeBytes: 0 }),
    deleteObject: async () => undefined,
  };
}
