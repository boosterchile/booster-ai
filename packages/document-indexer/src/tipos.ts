import type {
  Document,
  DocumentInsert,
  DocumentQuery,
  DocumentType,
} from '@booster-ai/shared-schemas';

export type { Document, DocumentInsert, DocumentQuery, DocumentType };

/**
 * Bytes a subir a GCS junto con el metadata mínimo. El indexer calcula
 * el sha256 si no se provee (default: lo calcula para asegurar
 * consistencia con la columna `sha256` de la tabla).
 */
export interface UploadInput {
  empresaId: string;
  tripId?: string;
  type: DocumentType;
  /** Path relativo al bucket. Si no se provee, el indexer lo deriva. */
  gcsPath?: string;
  body: Uint8Array | Buffer;
  mimeType: string;
  /** SHA-256 hex precomputado. Si se omite, el indexer lo calcula. */
  sha256?: string;
  folioSii?: string;
  rutEmisor?: string;
  emittedByUserId?: string;
  /** ISO 8601. Default = now() del indexer. */
  emittedAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Resultado del flujo upload + indexar. El caller suele guardar
 * `document.id` y/o `document.gcsPath` en su propio dominio.
 */
export interface UploadResult {
  document: Document;
  gcsUri: string;
}

/**
 * Port de persistencia. Cada app implementa este shape sobre su propia
 * instancia de Drizzle (o lo que sea). El package no asume conexión
 * compartida.
 */
export interface DocumentStore {
  insert(row: PersistedDocumentRow): Promise<Document>;
  findById(id: string): Promise<Document | null>;
  query(filter: DocumentQuery): Promise<Document[]>;
  /**
   * Sólo para tipos NO sujetos a retention legal. Implementaciones
   * deben rechazar (throw) los tipos en `documentTypesWithLegalRetention`.
   */
  softDelete(id: string): Promise<void>;
}

/**
 * Shape que el store recibe. Mantiene los nombres del schema canónico
 * en TS (camelCase) — el adapter Drizzle hace el mapping a SQL.
 */
export interface PersistedDocumentRow {
  empresaId: string;
  tripId: string | null;
  type: DocumentType;
  gcsPath: string;
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  folioSii: string | null;
  rutEmisor: string | null;
  emittedByUserId: string | null;
  emittedAt: string;
  retentionUntil: string | null;
  piiRedactedCopy: boolean;
  metadata: Record<string, unknown>;
}
