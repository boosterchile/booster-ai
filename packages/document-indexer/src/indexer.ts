import {
  type Document,
  type DocumentType,
  documentInsertSchema,
  documentTypesWithLegalRetention,
} from '@booster-ai/shared-schemas';
import { computeRetentionUntil } from './retention.js';
import { type UploadOutcome, buildGcsPath, uploadObject } from './storage.js';
import type { DocumentStore, PersistedDocumentRow, UploadInput, UploadResult } from './tipos.js';

/**
 * Error semántico para retention violations. Caller puede distinguirlo
 * de errores de IO o validación.
 */
export class DocumentRetentionError extends Error {
  constructor(public readonly type: DocumentType) {
    super(
      `Documento tipo '${type}' está sujeto a retención legal de 6 años (ADR-007). No se puede eliminar.`,
    );
    this.name = 'DocumentRetentionError';
  }
}

export interface IndexerOptions {
  bucket: string;
  store: DocumentStore;
  /** Para tests; default `() => new Date()`. */
  now?: () => Date;
}

/**
 * API principal del package. Encapsula:
 *   1. upload + indexar  (write-through coherente: GCS primero, luego DB)
 *   2. lookup por id     (verificación de integridad opcional via sha256)
 *   3. query por filtros (delegado al store)
 *   4. soft-delete       (rechaza tipos con retention legal)
 *
 * No mantiene state. Construir uno por request es válido si el `store`
 * inyectado es barato; lo natural es construirlo una vez por proceso.
 */
export class DocumentIndexer {
  private readonly bucket: string;
  private readonly store: DocumentStore;
  private readonly now: () => Date;

  constructor(opts: IndexerOptions) {
    this.bucket = opts.bucket;
    this.store = opts.store;
    this.now = opts.now ?? (() => new Date());
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const at = input.emittedAt ? new Date(input.emittedAt) : this.now();

    const gcsPath =
      input.gcsPath ??
      buildGcsPath({
        type: input.type,
        empresaId: input.empresaId,
        identifier: deriveIdentifier(input),
        emittedAt: at,
        ext: deriveExtension(input.mimeType),
      });

    const upload: UploadOutcome = await uploadObject({
      bucket: this.bucket,
      gcsPath,
      body: input.body,
      mimeType: input.mimeType,
      metadata: {
        empresa_id: input.empresaId,
        type: input.type,
        ...(input.tripId && { trip_id: input.tripId }),
        ...(input.folioSii && { folio_sii: input.folioSii }),
        ...(input.rutEmisor && { rut_emisor: input.rutEmisor }),
      },
    });

    if (input.sha256 && input.sha256 !== upload.sha256) {
      throw new Error(`sha256 mismatch: caller=${input.sha256} computed=${upload.sha256}`);
    }

    const row: PersistedDocumentRow = {
      empresaId: input.empresaId,
      tripId: input.tripId ?? null,
      type: input.type,
      gcsPath,
      sha256: upload.sha256,
      mimeType: input.mimeType,
      sizeBytes: upload.sizeBytes,
      folioSii: input.folioSii ?? null,
      rutEmisor: input.rutEmisor ?? null,
      emittedByUserId: input.emittedByUserId ?? null,
      emittedAt: at.toISOString(),
      retentionUntil: computeRetentionUntil({ type: input.type, emittedAt: at }),
      piiRedactedCopy: false,
      metadata: input.metadata ?? {},
    };

    // Validar shape antes de tocar la DB. Defensa en profundidad:
    // Drizzle también valida via constraints, pero un Zod parse temprano
    // da mejor error que un error SQL.
    documentInsertSchema.parse({
      ...row,
      // documentInsertSchema espera string IDs (post-parse), nuestro row
      // ya los tiene en string, pasa derecho.
    });

    const document = await this.store.insert(row);
    return { document, gcsUri: upload.gcsUri };
  }

  async findById(id: string): Promise<Document | null> {
    return this.store.findById(id);
  }

  async query(filter: import('./tipos.js').DocumentQuery): Promise<Document[]> {
    return this.store.query(filter);
  }

  /**
   * Soft-delete. Sólo permitido para tipos sin retention legal. El store
   * implementa el delete real (típicamente UPDATE de un flag); aquí
   * sólo aplicamos el guard.
   */
  async softDelete(id: string): Promise<void> {
    const doc = await this.store.findById(id);
    if (!doc) {
      throw new Error(`Documento no encontrado: ${id}`);
    }
    if (documentTypesWithLegalRetention.includes(doc.type)) {
      throw new DocumentRetentionError(doc.type);
    }
    await this.store.softDelete(id);
  }
}

function deriveIdentifier(input: UploadInput): string {
  if (input.folioSii && input.rutEmisor) {
    return `${input.rutEmisor}-${input.folioSii}`;
  }
  if (input.tripId) {
    return `${input.type}-${input.tripId}`;
  }
  // Fallback: hash corto + timestamp para no colisionar con otros
  // archivos del mismo tipo en el mismo mes. El indexer recalcula el
  // sha256 completo, así que basta con un nonce.
  return `${input.type}-${Date.now().toString(36)}`;
}

function deriveExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'application/json': 'json',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  return map[mimeType.toLowerCase()] ?? 'bin';
}
