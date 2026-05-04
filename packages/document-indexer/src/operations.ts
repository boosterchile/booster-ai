/**
 * Operaciones de alto nivel — el API que el caller (apps/document-service)
 * realmente consume. Cada función toma las interfaces abstractas
 * (`DocumentRepo`, `BlobStore`) y orquesta la lógica.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { ZodError } from 'zod';
import {
  DocumentIntegrityError,
  DocumentNotFoundError,
  DocumentValidationError,
} from './errors.js';
import {
  type RetentionConfig,
  assertRetentionExpired,
  computeRetentionUntil,
} from './retention.js';
import {
  type BlobStore,
  type DocumentRecord,
  type DocumentRepo,
  type IndexDocumentInput,
  type ListDocumentsFilter,
  indexDocumentInputSchema,
  listDocumentsFilterSchema,
} from './types.js';

/**
 * Persiste un nuevo documento en el índice. Compone:
 *   - `id` UUIDv4
 *   - `emittedAt` = ahora si no se pasa
 *   - `retentionUntil` = `emittedAt + 6 años` (configurable)
 *   - `piiRedactedCopyExists` = false inicialmente
 */
export async function indexDocument(
  repo: DocumentRepo,
  input: IndexDocumentInput,
  opts: { retention?: RetentionConfig } = {},
): Promise<DocumentRecord> {
  const parsed = indexDocumentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new DocumentValidationError(
      'Input inválido para indexDocument',
      flattenZodErrors(parsed.error),
    );
  }
  const data = parsed.data;
  const emittedAt = data.emittedAt ?? new Date();
  const record: DocumentRecord = {
    id: randomUUID(),
    tripId: data.tripId,
    type: data.type,
    gcsPath: data.gcsPath,
    sha256: data.sha256,
    folioSii: data.folioSii,
    emittedByUserId: data.emittedByUserId,
    emittedAt,
    retentionUntil: computeRetentionUntil(emittedAt, opts.retention),
    piiRedactedCopyExists: false,
    sizeBytes: data.sizeBytes,
  };
  await repo.insert(record);
  return record;
}

/**
 * Lista documentos con filtros opcionales. Aplica defaults de paginación
 * (limit=100, offset=0).
 */
export async function listDocuments(
  repo: DocumentRepo,
  filter: Partial<ListDocumentsFilter> = {},
): Promise<DocumentRecord[]> {
  const parsed = listDocumentsFilterSchema.safeParse(filter);
  if (!parsed.success) {
    throw new DocumentValidationError(
      'Filtros inválidos para listDocuments',
      flattenZodErrors(parsed.error),
    );
  }
  return repo.list(parsed.data);
}

/**
 * Recupera un documento por id. Throws si no existe.
 */
export async function getDocumentById(repo: DocumentRepo, id: string): Promise<DocumentRecord> {
  const record = await repo.findById(id);
  if (!record) {
    throw new DocumentNotFoundError(`Documento ${id} no encontrado`, id);
  }
  return record;
}

/**
 * Genera signed URL para download. La autorización de quién puede leer
 * el documento la hace el caller (HTTP middleware de role/ownership)
 * antes de invocar esta función.
 */
export async function getSignedReadUrl(
  blob: BlobStore,
  objectName: string,
  expiresInSeconds = 900,
): Promise<string> {
  return blob.getSignedReadUrl({ objectName, expiresInSeconds });
}

/**
 * Genera signed URL para upload (PUT directo del cliente a GCS sin
 * pasar por backend). El cliente debe matchear el `contentType` que
 * declaró acá.
 */
export async function getSignedUploadUrl(
  blob: BlobStore,
  args: {
    objectName: string;
    contentType: string;
    expiresInSeconds?: number;
  },
): Promise<string> {
  return blob.getSignedUploadUrl({
    objectName: args.objectName,
    contentType: args.contentType,
    expiresInSeconds: args.expiresInSeconds ?? 900,
  });
}

/**
 * Verifica que el SHA-256 de un buffer matchea el del registro. Throws
 * `DocumentIntegrityError` si no — útil post-download para garantizar
 * que el archivo no fue alterado en GCS.
 */
export function assertSha256Match(expected: string, buffer: Uint8Array | Buffer): void {
  const buf = buffer instanceof Buffer ? buffer : Buffer.from(buffer);
  const actual = createHash('sha256').update(buf).digest('hex');
  if (actual !== expected) {
    throw new DocumentIntegrityError(
      'SHA-256 mismatch: storage retornó contenido distinto al indexado',
      expected,
      actual,
    );
  }
}

/**
 * Elimina un documento si su retention venció. Sino, throws
 * `DocumentRetentionViolationError`. Patrón para job nocturno de cleanup.
 */
export async function deleteDocumentIfExpired(
  repo: DocumentRepo,
  blob: BlobStore,
  id: string,
  now: Date = new Date(),
): Promise<void> {
  const record = await getDocumentById(repo, id);
  assertRetentionExpired(record.retentionUntil, now);
  await blob.deleteObject(record.gcsPath);
  await repo.delete(record.id);
}

function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) {
      out[key] = [];
    }
    out[key].push(issue.message);
  }
  return out;
}
