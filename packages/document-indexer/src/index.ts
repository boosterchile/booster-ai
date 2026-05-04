/**
 * @booster-ai/document-indexer
 *
 * Helpers de índice y retrieval de documentos en Cloud Storage + Postgres.
 * Implementa el diseño de [ADR-007 § "Arquitectura de almacenamiento"](../../docs/adr/007-chile-document-management.md).
 *
 * Responsabilidades:
 *   - Construir paths GCS convencionales (`gcsPathFor`).
 *   - Calcular `retentionUntil` (`computeRetentionUntil`).
 *   - Validar retention pre-delete (`assertRetentionExpired`).
 *   - Validar integrity post-download (`assertSha256Match`).
 *   - Indexar + listar + retrieve documentos (vía interfaces abstractas
 *     `DocumentRepo` y `BlobStore` que el caller implementa con su stack).
 *
 * **No** depende de `drizzle-orm` ni `@google-cloud/storage` — para que
 * sea testeable end-to-end con mocks puros.
 *
 * @example
 * ```ts
 * import {
 *   gcsPathFor,
 *   computeRetentionUntil,
 *   indexDocument,
 *   listDocuments,
 *   getSignedReadUrl,
 *   type DocumentRepo,
 *   type BlobStore,
 * } from '@booster-ai/document-indexer';
 *
 * // En apps/document-service:
 * const repo: DocumentRepo = drizzleDocumentRepo(db);
 * const blob: BlobStore = gcsBlobStore(storage, bucket);
 *
 * const path = gcsPathFor({
 *   type: 'carta_porte',
 *   identifier: 'BOO-ABC123',
 *   emittedAt: new Date(),
 * });
 * // → 'carta-porte/2026/05/cp-BOO-ABC123.pdf'
 *
 * const record = await indexDocument(repo, {
 *   tripId,
 *   type: 'carta_porte',
 *   gcsPath: path,
 *   sha256,
 *   folioSii: null,
 *   emittedByUserId: userId,
 *   sizeBytes,
 * });
 *
 * const signedUrl = await getSignedReadUrl(blob, record.gcsPath, 900);
 * ```
 */

export type {
  DocumentRecord,
  DocumentType,
  IndexDocumentInput,
  ListDocumentsFilter,
  DocumentRepo,
  BlobStore,
} from './types.js';

export {
  documentTypeSchema,
  documentRecordSchema,
  indexDocumentInputSchema,
  listDocumentsFilterSchema,
} from './types.js';

export {
  DocumentIndexerError,
  DocumentValidationError,
  DocumentNotFoundError,
  DocumentIntegrityError,
  DocumentRetentionViolationError,
} from './errors.js';

export { gcsPathFor, redactedPathFor } from './paths.js';

export {
  computeRetentionUntil,
  assertRetentionExpired,
  isRetentionExpired,
  type RetentionConfig,
} from './retention.js';

export {
  indexDocument,
  listDocuments,
  getDocumentById,
  getSignedReadUrl,
  getSignedUploadUrl,
  assertSha256Match,
  deleteDocumentIfExpired,
} from './operations.js';
