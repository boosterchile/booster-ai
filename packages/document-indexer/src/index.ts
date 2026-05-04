/**
 * @booster-ai/document-indexer
 *
 * Capa de gestión documental — ADR-007 §"Almacenamiento, indexación y
 * retrieval". El package NO depende de un Drizzle DB instance concreto:
 * cada app inyecta un `DocumentStore` que implemente la persistencia.
 *
 * Layout canónico GCS:
 *   {bucket}/{prefix}/{yyyy}/{mm}/{empresaId}/{identifier}.{ext}
 *
 * El bucket se pasa al construir `DocumentIndexer`; default sugerido por
 * env: `DOCUMENTS_BUCKET=booster-ai-documents-{env}`.
 */

export { DocumentIndexer, DocumentRetentionError } from './indexer.js';
export type { IndexerOptions } from './indexer.js';
export {
  buildGcsPath,
  computeSha256,
  downloadObject,
  generateSignedDownloadUrl,
  setStorageForTesting,
  uploadObject,
} from './storage.js';
export type { UploadOpts, UploadOutcome } from './storage.js';
export {
  LEGAL_RETENTION_YEARS,
  computeRetentionUntil,
  isLegallyRetained,
} from './retention.js';
export type {
  Document,
  DocumentInsert,
  DocumentQuery,
  DocumentStore,
  DocumentType,
  PersistedDocumentRow,
  UploadInput,
  UploadResult,
} from './tipos.js';
